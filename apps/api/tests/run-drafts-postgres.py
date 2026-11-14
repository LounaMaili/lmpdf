"""Debian-only isolated PostgreSQL runner. No active service or volume changes.

Requires the API build-stage image already built from --sha. Outputs, generated
credentials and logs stay private outside Git. PostgreSQL data exists in tmpfs.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import time


def run(args, **kwargs):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs).stdout


parser = argparse.ArgumentParser()
parser.add_argument("--sha", required=True)
parser.add_argument("--output", required=True)
options = parser.parse_args()
assert re.fullmatch(r"[0-9a-f]{40}", options.sha)
repo = Path(__file__).resolve().parents[3]
os.chdir(repo)
assert run(["git", "rev-parse", "HEAD"], text=True).strip() == options.sha
assert not run(["git", "status", "--porcelain", "--untracked-files=no"], text=True)
os.umask(0o077)
output = Path(options.output).resolve()
assert not output.is_relative_to(repo), "Private output must stay outside Git"
output.mkdir(mode=0o700, parents=True, exist_ok=False)
api_image = "lmpdf-qa-api-build:" + options.sha
image = json.loads(run(["docker", "image", "inspect", api_image]))[0]
assert image["Config"]["Labels"]["org.opencontainers.image.revision"] == options.sha
run(["docker", "image", "inspect", "postgres:16"])
stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M%S")
network = f"lmpdf-isolated-drafts-net-{stamp}-{os.getpid()}"
pg_name = f"lmpdf-isolated-drafts-pg-{stamp}-{os.getpid()}"
database = "lmpdf_draft_validation"
admin_user = "lmpdf_draft_admin"
api_user = "lmpdf_draft_validation"
admin_password, api_password = secrets.token_hex(32), secrets.token_hex(32)
admin_url = f"postgresql://{admin_user}:{admin_password}@{pg_name}:5432/{database}?connection_limit=1"
api_url = f"postgresql://{api_user}:{api_password}@{pg_name}:5432/{database}?connection_limit=1"
pg_env, api_env = output / "postgres.env", output / "api-test.env"
pg_env.write_text(f"POSTGRES_USER={admin_user}\nPOSTGRES_PASSWORD={admin_password}\nPOSTGRES_DB={database}\n")
api_env.write_text(f"DATABASE_URL={api_url}\nDRAFT_TEST_ADMIN_URL={admin_url}\nLMPDF_ISOLATED_DRAFT_TESTS=1\n")
pg_id = network_id = None
try:
    print("Creating a private internal network and tmpfs PostgreSQL", flush=True)
    network_id = run(["docker", "network", "create", "--internal", "--label", "lmpdf.validation=" + options.sha, network], text=True).strip()
    pg_id = run(["docker", "run", "-d", "--rm", "--name", pg_name, "--network", network,
                 "--label", "lmpdf.validation=" + options.sha, "--memory", "512m", "--cpus", "1",
                 "--tmpfs", "/var/lib/postgresql/data:rw,size=256m", "--env-file", str(pg_env), "postgres:16"], text=True).strip()
    deadline = time.monotonic() + 30
    while subprocess.run(["docker", "exec", pg_id, "pg_isready", "-h", "127.0.0.1", "-U", admin_user, "-d", database], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        assert time.monotonic() < deadline, "Temporary PostgreSQL not ready"
        time.sleep(0.2)
    print("Generating schema SQL without connecting to any database", flush=True)
    schema = run(["docker", "run", "--rm", "--network", "none", "--read-only", "--tmpfs", "/tmp:rw,size=128m",
                  "--entrypoint", "sh", "--workdir", "/app/apps/api", "--env-file", str(api_env), api_image,
                  "-c", "pnpm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script"])
    (output / "isolated-schema.sql").write_bytes(schema)
    run(["docker", "exec", "-i", pg_id, "psql", "-U", admin_user, "-d", database, "-v", "ON_ERROR_STOP=1"], input=schema)
    grants = f"""CREATE ROLE {api_user} LOGIN PASSWORD '{api_password}' NOSUPERUSER;
GRANT USAGE ON SCHEMA public TO {api_user};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {api_user};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {api_user};
"""
    run(["docker", "exec", "-i", pg_id, "psql", "-U", admin_user, "-d", database, "-v", "ON_ERROR_STOP=1"], input=grants.encode())
    print("Running real PostgreSQL HTTP and late-autosave tests", flush=True)
    args = ["docker", "run", "--rm", "--network", network, "--read-only", "--tmpfs", "/tmp:rw,size=256m",
            "--memory", "512m", "--cpus", "1", "--entrypoint", "node", "--workdir", "/app/apps/api",
            "--env-file", str(api_env)]
    for env, filename in [("TEMPLATE_DRAFT_HELPER_PATH", "utils/preserveTemplateDraft.ts"),
                          ("DRAFT_WEB_API_PATH", "api.ts"), ("AUTOSAVE_SCHEDULER_PATH", "hooks/autosaveScheduler.ts")]:
        target = "/qa/" + Path(filename).name
        args += ["-e", env + "=" + target, "-v", str(repo / "apps/web/src" / filename) + ":" + target + ":ro"]
    args += [api_image, "--test", "tests/drafts-postgres.test.cjs"]
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (output / "postgres-http-tests.log").write_bytes(result.stdout)
    lines = result.stdout.decode(errors="replace").splitlines()
    summary = [line for line in lines if line.startswith(("# tests", "# pass", "# fail", "# skipped", "not ok", "ok "))]
    report = {"sha": options.sha, "image": image["Id"], "schemaSha256": hashlib.sha256(schema).hexdigest(),
              "database": database, "temporaryPostgres": pg_id, "exitCode": result.returncode,
              "summary": summary, "realVolumesMounted": False, "portsPublished": False}
    (output / "result.json").write_text(json.dumps(report, indent=2))
    print("\n".join(summary), flush=True)
    assert result.returncode == 0, "Isolated PostgreSQL tests failed; see private log"
finally:
    # Only resources created by this invocation are eligible; never use Compose
    # down, prune, broad name filters, rm -v, or an existing application volume.
    if pg_id:
        state = subprocess.run(["docker", "inspect", pg_id, "--format", '{{index .Config.Labels "lmpdf.validation"}}'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        if state.returncode == 0:
            assert state.stdout.strip() == options.sha
            run(["docker", "stop", "--time", "5", pg_id])
    if network_id:
        run(["docker", "network", "rm", network_id])
