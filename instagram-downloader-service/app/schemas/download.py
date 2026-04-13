from typing import Literal

from pydantic import BaseModel, Field


MediaType = Literal["reel", "post", "carousel", "unknown"]
FileType = Literal["video", "image", "unknown"]


class GoogleDriveUploadRequest(BaseModel):
    access_token: str = Field(min_length=1)
    parent_folder_id: str | None = None


class DownloadRequest(BaseModel):
    url: str = Field(min_length=1)
    google_drive: GoogleDriveUploadRequest | None = None
    include_analysis: bool = True
    download_base_dir: str | None = None


class DownloadedFile(BaseModel):
    filename: str
    filepath: str
    type: FileType


class InstagramMediaItem(BaseModel):
    index: int = 0
    label: str = ""
    type: FileType = "unknown"
    filename: str | None = None
    filepath: str | None = None
    source_url: str | None = None
    thumbnail_url: str | None = None
    width: int | None = None
    height: int | None = None
    duration_seconds: float | None = None


class GoogleDriveFile(BaseModel):
    id: str
    name: str
    mime_type: str | None = None
    url: str
    size: int | None = None


class GoogleDriveFolder(BaseModel):
    id: str
    name: str
    url: str


class DownloadResponse(BaseModel):
    success: bool
    input_url: str | None = None
    media_type: MediaType | None = "unknown"
    media_type_label: str | None = None
    download_dir: str | None = None
    files: list[DownloadedFile] = Field(default_factory=list)
    media_items: list[InstagramMediaItem] = Field(default_factory=list)
    drive_folder: GoogleDriveFolder | None = None
    drive_files: list[GoogleDriveFile] = Field(default_factory=list)
    normalized_title: str | None = None
    creator_handle: str | None = None
    caption: str | None = None
    published_at: str | None = None
    thumbnail_url: str | None = None
    extractor: str | None = None
    review_state: str | None = None
    review_reason: str | None = None
    claim_token: str | None = None
    worker_id: str | None = None
    error: str | None = None


class YouTubeTranscriptRequest(BaseModel):
    url: str = Field(min_length=1)
    preferred_subtitle_languages: list[str] = Field(default_factory=list)
    prefer_manual_captions: bool = True


class YouTubeTranscriptResponse(BaseModel):
    success: bool
    input_url: str | None = None
    transcript: str = ""
    language: str = ""
    status: str = ""
    error: str | None = None
    transcript_source: str = "worker_youtube_transcript_api"
    selected_mode: str = ""
    claim_token: str | None = None
    worker_id: str | None = None


class WorkerHeartbeatRequest(BaseModel):
    worker_id: str
    label: str | None = None
    version: str | None = None
    metadata: dict = Field(default_factory=dict)
    current_job_id: str | None = None


class WorkerClaimedJob(BaseModel):
    id: str
    owner_user_id: str
    resource_id: str
    source_url: str
    status: str
    retry_count: int = 0
    last_error: str | None = None
    drive_target: str | None = None
    drive_folder_id: str | None = None
    project_id: str | None = None
    include_analysis: bool = True
    worker_id: str | None = None
    requested_at: str | None = None
    scheduled_for: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    payload: dict = Field(default_factory=dict)


class WorkerClaimEnvelope(BaseModel):
    job: WorkerClaimedJob
    google_drive: GoogleDriveUploadRequest
    settings: dict = Field(default_factory=dict)
