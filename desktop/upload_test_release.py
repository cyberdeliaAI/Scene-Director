"""Deliver already-verified signed files without consuming Actions artifact storage."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent


def main():
    version = json.loads((ROOT/'desktop/package.json').read_text())['version']
    directory = ROOT/'desktop/dist'/version/'artifacts'
    archive = directory/f'Scene_Director_{version}_macOS_arm64.zip'
    checksum = archive.with_name(archive.name+'.sha256')
    proof = archive.with_name(archive.stem+'.signing.json')
    report = json.loads(proof.read_text())
    commit = subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    required = ('developer_id','hardened_runtime','stapled_notarization_ticket','gatekeeper',
                'bundled_service_tests','native_window_started','extracted_archive_verified','portable_https_roots')
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    if (report.get('version') != version or report.get('source_commit') != commit or
            report.get('archive') != archive.name or report.get('sha256') != digest or
            not all(report.get(key) is True for key in required) or
            checksum.read_text().strip() != digest+'  '+archive.name):
        raise RuntimeError('The archive lacks complete, matching signed verification proof.')
    tag = 'v'+version
    result = subprocess.run(['gh','release','view',tag,'--json','isDraft,targetCommitish,assets'],capture_output=True,text=True)
    files = [archive,checksum,proof]
    if result.returncode == 0:
        previous = json.loads(result.stdout)
        if not previous['isDraft'] or previous['targetCommitish'] != commit or previous['assets']:
            raise RuntimeError('Refusing to replace an existing release or its files.')
        subprocess.run(['gh','release','upload',tag,*map(str,files)],check=True)
    else:
        subprocess.run(['gh','release','create',tag,*map(str,files),'--target',commit,'--draft','--prerelease',
                        '--title',f'Scene Director {version} — signed Apple Silicon test',
                        '--notes-file',str(ROOT/'.github/release-notes'/f'{version}.md')],check=True)
    remote = json.loads(subprocess.check_output(['gh','release','view',tag,'--json','isDraft,assets'],text=True))
    if not remote['isDraft'] or len(remote['assets']) != len(files):
        raise RuntimeError('The private draft release has an unexpected set of files.')
    expected = {p.name:'sha256:'+hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    for asset in remote['assets']:
        if asset['state'] != 'uploaded' or asset.get('digest') != expected.get(asset['name']):
            raise RuntimeError('The uploaded file checksum does not match the verified download.')
    print('Verified signed test files uploaded to a private draft release. Publication remains a separate step.')


if __name__=='__main__':
    main()
