"""Fast isolated startup preflight, with a traceback if the runner stalls."""
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parent.parent


def main():
    print('Source startup interpreter:', sys.executable, sys.version.split()[0], flush=True)
    with tempfile.TemporaryDirectory(prefix='scene-director-startup-') as folder:
        env = {key:value for key,value in os.environ.items() if not key.startswith(('APPLE_', 'CSC_', 'WIN_CSC_'))}
        env.update(SCENE_DIRECTOR_DESKTOP_DATA_DIR=str(Path(folder)/'profile'),
                   SCENE_DIRECTOR_DESKTOP_OUTPUT_DIR=str(Path(folder)/'prompts'),
                   SCENE_DIRECTOR_DESKTOP_TOKEN='startup-check-'+ 'a'*40)
        code = ('import sys,faulthandler,runpy; faulthandler.dump_traceback_later(12); '
                'sys.path.insert(0,'+repr(str(ROOT))+'); '
                'runpy.run_path('+repr(str(ROOT/'scene_director_desktop.py'))+',run_name="__main__")')
        process = subprocess.Popen([sys.executable,'-u','-c',code],env=env,cwd=folder,
                                   stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        try:
            messages = queue.Queue()
            threading.Thread(target=lambda: messages.put(process.stdout.readline()), daemon=True).start()
            try:
                ready = messages.get(timeout=25)
            except queue.Empty:
                process.kill(); process.wait(timeout=5)
                print(process.stderr.read().decode(errors='replace'),flush=True)
                raise RuntimeError('Desktop source did not report ready within 25 seconds.')
            if not ready or json.loads(ready).get('type')!='ready':
                raise RuntimeError('Desktop source exited without its ready message.')
            print('Private desktop source reported ready.',flush=True)
        finally:
            process.stdin.close()
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait(timeout=5)
            for stream in (process.stdout,process.stderr):stream.close()


if __name__=='__main__':
    main()
