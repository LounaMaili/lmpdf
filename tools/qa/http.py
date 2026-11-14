"""Normal HTTPS API checks on approved synthetic fixtures, on Debian only.

Usage: python3 http.py PRIVATE_QA_DIRECTORY prepare|share|matrix
No JWT is printed or persisted. No historical document is addressed.
"""
import json
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BASE = "https://lmpdf.gueguen.org/api"
root, mode = Path(sys.argv[1]), sys.argv[2]
assert mode in ("prepare", "share", "matrix")
ledger = json.loads((root / "private-accounts.json").read_text())
objects = json.loads((root / "qa-objects.json").read_text())
assert ledger["campaign"] == "RECETTE-20261114"
actors = {a["alias"]: a for a in ledger["accounts"]}
documents = objects["documents"]
assert documents and all(d["ownerId"] == actors["owner"]["id"] and d["originalName"].startswith("RECETTE-20261114-") for d in documents)
tokens = {}


def request(method, path, actor=None, body=None, raw=None, content_type=None):
    headers = {"Accept": "application/json"}
    if actor:
        if actor not in tokens:
            a = actors[actor]
            status, result = request("POST", "/auth/login", body={"email": a["email"], "password": a["password"]})
            assert status == 200 and result.get("token") and not result.get("mfaRequired"), "Normal QA login unavailable"
            tokens[actor] = result["token"]
        headers["Authorization"] = "Bearer " + tokens[actor]
    if body is not None:
        raw, content_type = json.dumps(body).encode(), "application/json"
    if content_type:
        headers["Content-Type"] = content_type
    try:
        with urlopen(Request(BASE + path, data=raw, headers=headers, method=method), timeout=60) as response:
            content, status = response.read(), response.status
    except HTTPError as error:
        content, status = error.read(), error.code
    try:
        return status, json.loads(content)
    except (ValueError, UnicodeDecodeError):
        return status, {"bytes": len(content)}


results = []


def check(label, status, expected):
    results.append({"case": label, "status": status, "expected": expected, "pass": status in expected})
    assert status in expected, "Unexpected HTTP result: " + label


if mode == "prepare":
    status, templates = request("GET", "/templates", "owner")
    check("owner lists templates", status, [200])
    for doc in documents:
        if any(t.get("sourceFileId") == doc["id"] for t in templates):
            continue
        suffix = "PDF-BASE" if doc["mimeType"] == "application/pdf" else "PNG-BASE"
        status, template = request("POST", "/templates", "owner", {
            "name": "RECETTE-20261114-" + suffix, "sourceFileId": doc["id"], "rotation": 0, "fields": [],
        })
        check("create synthetic base " + suffix, status, [201])
        results.append({"templateId": template["id"], "sourceFileId": doc["id"]})
elif mode == "share":
    for doc in documents:
        status, existing = request("GET", f"/documents/{doc['id']}/permissions", "owner")
        check("owner lists QA shares", status, [200])
        for actor in ("editor", "filler"):
            if any(p.get("userId") == actors[actor]["id"] and p.get("docRole") == actor for p in existing):
                continue
            status, permission = request("POST", f"/documents/{doc['id']}/permissions", "owner", {
                "userId": actors[actor]["id"], "docRole": actor,
            })
            check("share QA document to " + actor, status, [201])
            results.append({"permissionId": permission["id"], "documentId": doc["id"], "actor": actor})
else:
    for actor, role in (("owner", "owner"), ("editor", "editor"), ("filler", "filler"), ("outsider", None)):
        status, _ = request("GET", "/admin/settings", actor)
        check(actor + " cannot read admin settings", status, [403])
        for doc in documents:
            doc_id = doc["id"]
            status, effective = request("GET", f"/documents/{doc_id}/permissions/me", actor)
            check(actor + " resolves document role", status, [200])
            assert effective["docRole"] == role
            for path in (f"/uploads/{doc_id}", f"/uploads/file/{doc_id}"):
                status, _ = request("GET", path, actor)
                check(actor + " reads " + path, status, [403] if actor == "outsider" else [200])
            if actor in ("filler", "outsider"):
                status, _ = request("POST", "/templates", actor, {
                    "name": "RECETTE-20261114-REFUSED-" + actor, "sourceFileId": doc_id, "rotation": 0, "fields": [],
                })
                check(actor + " cannot save structure", status, [403])
                status, _ = request("POST", "/detect", actor, {"documentId": doc_id})
                check(actor + " cannot run detection", status, [403])
                status, _ = request("POST", f"/documents/{doc_id}/permissions", actor, {
                    "userId": actors["outsider"]["id"], "docRole": "filler",
                })
                check(actor + " cannot grant shares", status, [403])
    boundary = "----LMPDF-QA-20261114-INVALID"
    raw = ("--" + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="RECETTE-INVALID.pdf"\r\n'
           "Content-Type: application/pdf\r\n\r\nTHIS IS NOT A PDF\r\n--" + boundary + "--\r\n").encode()
    for actor, expected in (("outsider", [403]), ("owner", [400])):
        status, _ = request("POST", "/uploads/document", actor, raw=raw, content_type="multipart/form-data; boundary=" + boundary)
        check(actor + " rejected synthetic upload", status, expected)

report = {"method": "real HTTPS API, normal QA logins", "mode": mode, "results": results}
(root / "evidence" / ("http-" + mode + ".json")).write_text(json.dumps(report, indent=2))
print(json.dumps(report))
