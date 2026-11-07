"""Stage verified platform downloads in one draft; refuse incomplete releases."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

from verify_native import ROOT, TARGETS, native_target

REPOSITORY = 'cyberdeliaAI/Scene-Director'
REQUIRED = ('native_architecture','bundled_assets','portable_https_roots','bundled_service_tests',
            'native_window_started','renderer_isolation','clean_service_shutdown','extracted_archive_verified')
MAC_REQUIRED = ('developer_id','hardened_runtime','stapled_notarization_ticket','gatekeeper')


def gh(*args, optional=False):
    result = subprocess.run(['gh',*args],capture_output=True,text=True)
    if result.returncode:
        if optional: return None
        raise RuntimeError('GitHub release operation failed: '+result.stderr.strip())
    return result.stdout


def metadata():
    version = json.loads((ROOT/'desktop/package.json').read_text())['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:-beta\.\d+)?',version):
        raise RuntimeError('Invalid release version.')
    commit = subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    if os.environ.get('GH_REPO',REPOSITORY)!=REPOSITORY:
        raise RuntimeError('Release uploads are restricted to the Scene Director repository.')
    return version, commit


def names(version,target):
    stem = f'scene-director-{version}-{target}'
    archive = stem+('.tar.gz' if target=='linux-x64' else '.zip')
    return archive, archive+'.sha256', stem+'.verification.json'


def check_report(report,version,commit,target):
    archive = names(version,target)[0]
    required = REQUIRED+(MAC_REQUIRED if target.startswith('macos-') else ())
    if (report.get('version')!=version or report.get('source_commit')!=commit or report.get('target')!=target or
            report.get('archive')!=archive or not re.fullmatch(r'[0-9a-f]{64}',report.get('sha256','')) or
            not all(report.get(key) is True for key in required)):
        raise RuntimeError('Missing or mismatched native verification proof for '+target)
    if target.startswith('macos-') and report.get('nested_native_files_verified',0)<3:
        raise RuntimeError('Missing nested Mac signing proof.')
    return archive,report['sha256']


def draft(version,commit,optional=False):
    data = gh('release','view','v'+version,'--repo',REPOSITORY,'--json','isDraft,targetCommitish,assets',optional=optional)
    if data is None: return None
    release = json.loads(data)
    if not release['isDraft'] or release['targetCommitish']!=commit:
        raise RuntimeError('Refusing to alter a published release or a draft for another revision.')
    return release


def upload_missing(version,commit,files):
    release = draft(version,commit)
    remote = {a['name']:a for a in release['assets']}
    pending=[]
    expected={p.name:'sha256:'+hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    for path in files:
        if path.name in remote:
            if remote[path.name].get('digest')!=expected[path.name] or remote[path.name]['state']!='uploaded':
                raise RuntimeError('Refusing to replace mismatched existing release asset: '+path.name)
        else: pending.append(str(path))
    if pending: gh('release','upload','v'+version,'--repo',REPOSITORY,*pending)
    final = {a['name']:a for a in draft(version,commit)['assets']}
    if any(final.get(name,{}).get('digest')!=digest or final[name]['state']!='uploaded' for name,digest in expected.items()):
        raise RuntimeError('Uploaded native files failed checksum verification.')


def initialize(version,commit):
    existing=draft(version,commit,optional=True)
    if existing is None:
        args=['release','create','v'+version,'--repo',REPOSITORY,'--target',commit,'--draft',
              '--title','Scene Director '+version,'--notes-file',str(ROOT/'.github/release-notes'/f'{version}.md')]
        if '-beta.' in version: args.append('--prerelease')
        gh(*args)
    draft(version,commit)
    print('Draft prepared for the exact source revision. No downloads published.')


def upload_platform(version,commit):
    target=native_target()
    folder=ROOT/'desktop/dist'/version/'artifacts'
    archive_name,checksum_name,report_name=names(version,target)
    paths=[folder/name for name in (archive_name,checksum_name,report_name)]
    report=json.loads(paths[2].read_text())
    _,digest=check_report(report,version,commit,target)
    if hashlib.sha256(paths[0].read_bytes()).hexdigest()!=digest or paths[1].read_text().strip()!=digest+'  '+archive_name:
        raise RuntimeError('The native download does not match its verified proof.')
    upload_missing(version,commit,paths)
    print('Verified native download uploaded to draft: '+target)


def verify_complete(version,commit):
    release=draft(version,commit)
    assets={a['name']:a for a in release['assets']}
    expected={name for target in TARGETS for name in names(version,target)}
    if set(assets) not in (expected, expected|{'SHA256SUMS','verification.json'}):
        raise RuntimeError('Release must contain exactly all four native downloads, checksums and reports.')
    if any(a['state']!='uploaded' for a in assets.values()):
        raise RuntimeError('Release upload is incomplete.')
    with tempfile.TemporaryDirectory(prefix='scene-director-release-proof-') as directory:
        folder=Path(directory)
        gh('release','download','v'+version,'--repo',REPOSITORY,'--dir',str(folder),'--pattern','*.verification.json','--pattern','*.sha256')
        reports=[]; sums=[]
        for target in TARGETS:
            archive_name,checksum_name,report_name=names(version,target)
            for name in (checksum_name,report_name):
                if assets[name].get('digest')!='sha256:'+hashlib.sha256((folder/name).read_bytes()).hexdigest():
                    raise RuntimeError('Downloaded proof checksum mismatch.')
            report=json.loads((folder/report_name).read_text())
            _,digest=check_report(report,version,commit,target)
            if assets[archive_name].get('digest')!='sha256:'+digest or (folder/checksum_name).read_text().strip()!=digest+'  '+archive_name:
                raise RuntimeError('A staged download does not match its native proof.')
            reports.append(report);sums.append(digest+'  '+archive_name)
        manifest=folder/'verification.json';manifest.write_text(json.dumps({'version':version,'source_commit':commit,'complete':True,'targets':reports},indent=2)+'\n',encoding='utf-8')
        checksums=folder/'SHA256SUMS';checksums.write_text('\n'.join(sums)+'\n',encoding='ascii')
        upload_missing(version,commit,[manifest,checksums])
    print('All four extracted native downloads are verified. Draft is ready for publication.')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation',choices=('initialize','upload','verify'))
    args=parser.parse_args()
    version,commit=metadata()
    {'initialize':initialize,'upload':upload_platform,'verify':verify_complete}[args.operation](version,commit)


if __name__=='__main__':
    main()
