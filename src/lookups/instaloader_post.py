#!/usr/bin/env python3
"""Reads one Instagram post with Instaloader and prints it as a single line of JSON. Nothing is written to disk.

Used by /instagram repost for what yt-dlp can't do: photo posts and carousels. Usage: instaloader_post.py <shortcode>

A public post normally works without logging in. Instagram sometimes wants a login (or rate-limits an address), and then a session
file made with `instaloader --login=NAME` helps: set INSTALOADER_USER to NAME and INSTALOADER_SESSIONFILE to the file's path.

Prints {"ok": true, ...post} or {"ok": false, "kind": "login|notfound|ratelimit|error", "message": "..."} and exits 0 or 1.
"""
import json
import os
import sys

import instaloader
from instaloader import exceptions as ex


def fail(kind, message):
    print(json.dumps({"ok": False, "kind": kind, "message": str(message)[:300]}))
    sys.exit(1)


def media_of(post):
    """Every photo or video in the post, in order: a carousel gives one entry per slide."""
    if post.typename == "GraphSidecar":
        return [{"type": "video" if n.is_video else "image", "url": n.video_url if n.is_video else n.display_url} for n in post.get_sidecar_nodes()]
    return [{"type": "video" if post.is_video else "image", "url": post.video_url if post.is_video else post.url}]


def main(shortcode):
    # sleep=False: by default Instaloader waits a random second or two (sometimes ten) before every request to look less like a
    # bot, which is most of the time a single post takes. One request per command needs no disguise; its rate limits still apply.
    loader = instaloader.Instaloader(
        quiet=True, sleep=False, max_connection_attempts=1, request_timeout=25, download_pictures=False, download_videos=False,
        download_video_thumbnails=False, download_geotags=False, download_comments=False, save_metadata=False,
    )
    user, session = os.environ.get("INSTALOADER_USER"), os.environ.get("INSTALOADER_SESSIONFILE")
    if user and session:
        try:
            loader.load_session_from_file(user, session)
        except Exception as e:  # a missing or stale session file just means trying without one
            print("session not loaded: %s" % e, file=sys.stderr)
    try:
        post = instaloader.Post.from_shortcode(loader.context, shortcode)
        owner = post._node.get("owner") or {}
        likes, comments = post.likes, post.comments
        print(json.dumps({
            "ok": True,
            "shortcode": shortcode,
            "username": post.owner_username,
            "full_name": owner.get("full_name") or None,
            "avatar": owner.get("profile_pic_url") or None,
            "verified": bool(owner.get("is_verified")),
            "caption": post.caption or "",
            "timestamp": int(post.date_utc.timestamp()),
            "likes": likes if likes is not None and likes >= 0 else None,  # -1 when the owner hides them
            "comments": comments,
            "views": post.video_view_count,
            "media": media_of(post),
        }))
    except (ex.LoginRequiredException, ex.PrivateProfileNotFollowedException) as e:
        fail("login", e)
    except ex.BadResponseException as e:
        fail("login", e)  # "Fetching Post metadata failed": what an anonymous request gets when Instagram wants a login
    except ex.QueryReturnedNotFoundException as e:
        fail("notfound", e)
    except ex.TooManyRequestsException as e:
        fail("ratelimit", e)
    except ex.ConnectionException as e:
        # Anonymous requests that Instagram turns away arrive as "Fetching Post metadata failed" or a 401/403/429 status.
        text = str(e)
        fail("ratelimit" if "429" in text else "login" if any(c in text for c in ("401", "403", "metadata failed")) else "error", text)
    except Exception as e:
        fail("error", "%s: %s" % (type(e).__name__, e))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        fail("error", "usage: instaloader_post.py <shortcode>")
    main(sys.argv[1])
