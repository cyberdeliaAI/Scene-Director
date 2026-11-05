"""Private Electron backend entry point, also used by the bundled worker."""

import json
import os
import signal
import subprocess
import sys
import threading
from pathlib import Path

import scene_director as engine
import scene_director_web as web


def main():
    data_dir = Path(os.environ["SCENE_DIRECTOR_DESKTOP_DATA_DIR"]).expanduser().resolve()
    data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    engine.SETTINGS_FILE = data_dir / "settings.json"
    engine.OUTPUT_DIR = Path(os.environ.get("SCENE_DIRECTOR_DESKTOP_OUTPUT_DIR") or
                             str(Path.home() / "Documents" / "Scene Director" / "prompts"))
    if sys.argv[1:2] == ["--worker"]:
        return engine.main(sys.argv[2:])

    token = os.environ.get("SCENE_DIRECTOR_DESKTOP_TOKEN", "")
    if len(token) < 32:
        raise RuntimeError("The desktop session token is missing.")
    worker = ([sys.executable, "--worker"] if getattr(sys, "frozen", False) else
              [sys.executable, "-u", str(Path(__file__).resolve()), "--worker"])
    server, application = web.create_server(port=0, settings_file=engine.SETTINGS_FILE,
        output_dir=engine.OUTPUT_DIR, auth_token=token, worker_command=worker)

    # Losing the Electron parent closes stdin, including after a crash.
    # shutdown() runs on another thread so it cannot deadlock serve_forever().
    def shutdown(*_args):
        threading.Thread(target=server.shutdown, daemon=True).start()

    def watch_parent():
        try:
            sys.stdin.buffer.read()
        finally:
            shutdown()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    threading.Thread(target=watch_parent, daemon=True).start()
    print(json.dumps({"type": "ready", "port": server.server_port, "version": engine.VERSION}), flush=True)
    try:
        server.serve_forever(poll_interval=0.2)
    finally:
        application.stop()
        if application.job is not None:
            process = application.job.process
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
