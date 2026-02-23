#!/usr/bin/env python3
import json
from pathlib import Path

import click
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

SCOPES = [
    "https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata",
    "https://www.googleapis.com/auth/photoslibrary.appendonly",
    "https://www.googleapis.com/auth/photoslibrary.edit.appcreateddata",
]
DEFAULT_TOKEN = Path(__file__).with_name("token.json")


def get_creds(client_secrets: Path, token_path: Path):
    creds = None
    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(str(client_secrets), SCOPES)
            creds = flow.run_local_server(port=0)
        token_path.write_text(creds.to_json())

    return creds


def photos_service(creds):
    return build("photoslibrary", "v1", credentials=creds, static_discovery=False)


@click.group()
def cli():
    """Minimal Google Photos API helper."""


@cli.command("auth-check")
@click.option("--client-secrets", required=True, type=click.Path(exists=True, path_type=Path))
@click.option("--token", "token_path", default=str(DEFAULT_TOKEN), type=click.Path(path_type=Path))
def auth_check(client_secrets: Path, token_path: Path):
    creds = get_creds(client_secrets, token_path)
    service = photos_service(creds)
    resp = service.albums().list(pageSize=5).execute()
    click.echo("Auth OK")
    click.echo(json.dumps({"sample_albums": resp.get("albums", [])}, indent=2))


@cli.command("create-album")
@click.option("--client-secrets", required=True, type=click.Path(exists=True, path_type=Path))
@click.option("--token", "token_path", default=str(DEFAULT_TOKEN), type=click.Path(path_type=Path))
@click.option("--title", required=True)
def create_album(client_secrets: Path, token_path: Path, title: str):
    creds = get_creds(client_secrets, token_path)
    service = photos_service(creds)
    resp = service.albums().create(body={"album": {"title": title}}).execute()
    click.echo(json.dumps(resp, indent=2))


@cli.command("list-albums")
@click.option("--client-secrets", required=True, type=click.Path(exists=True, path_type=Path))
@click.option("--token", "token_path", default=str(DEFAULT_TOKEN), type=click.Path(path_type=Path))
@click.option("--limit", default=50, type=int)
def list_albums(client_secrets: Path, token_path: Path, limit: int):
    creds = get_creds(client_secrets, token_path)
    service = photos_service(creds)

    albums = []
    page_token = None
    while len(albums) < limit:
        resp = service.albums().list(pageSize=min(50, limit - len(albums)), pageToken=page_token).execute()
        albums.extend(resp.get("albums", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break

    click.echo(json.dumps(albums, indent=2))


if __name__ == "__main__":
    cli()
