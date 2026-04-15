import os
import logging
from pathlib import Path

from fastapi import FastAPI
from pydantic import BaseModel

from detector import detect_fields

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("vision")

UPLOADS_DIR = os.environ.get("UPLOADS_DIR", "/uploads")

app = FastAPI(title="LMPdf Vision Service")


class DocumentInfo(BaseModel):
    id: str
    path: str
    mimeType: str


class DetectPayload(BaseModel):
    document: DocumentInfo | None = None
    options: dict | None = None


@app.get("/health")
def health():
    return {"status": "ok", "service": "vision"}


@app.post("/detect")
def detect(payload: DetectPayload):
    if not payload.document:
        return {"error": "No document provided", "suggestedFields": []}

    file_path = Path(UPLOADS_DIR) / payload.document.path

    if not file_path.exists():
        logger.error(f"File not found: {file_path}")
        return {"error": f"File not found: {payload.document.path}", "suggestedFields": []}

    options = payload.options or {}
    mime = payload.document.mimeType

    logger.info(f"Detecting fields in {file_path} (mime={mime})")

    try:
        fields = detect_fields(str(file_path), mime, options)
        logger.info(f"Detected {len(fields)} fields")
        return {
            "suggestedFields": fields,
            "inputDocument": payload.document.model_dump(),
        }
    except Exception as e:
        logger.exception("Detection failed")
        return {"error": str(e), "suggestedFields": []}
