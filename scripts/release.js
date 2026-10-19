// Local release: bump the version, publish to npm, push the commit and tag.
//   npm run release -- patch|minor|major|<version>
// npm asks for 2FA in the browser during publish; `prepublishOnly` runs the tests first.
const { execFileSync } = require('child_process')

const bump = process.argv[2]
if (!bump) {
    console.error('Usage: npm run release -- <patch|minor|major|x.y.z>')
    process.exit(1)
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' })
const out = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf-8' }).trim()

if (out('git', ['branch', '--show-current']) !== 'main') {
    console.error('Release from the main branch.')
    process.exit(1)
}
if (out('git', ['status', '--porcelain'])) {
    console.error('Working tree is not clean; commit or stash first.')
    process.exit(1)
}
run('git', ['pull', '--ff-only'])

// Creates the "chore(release): x.y.z" commit and the vX.Y.Z tag.
run(npm, ['version', bump, '-m', 'chore(release): %s'])
try {
    run(npm, ['publish'])
} catch (e) {
    const version = require('../package.json').version
    console.error(`\nPublish failed. To retry: npm publish\nTo undo the bump: git tag -d v${version} && git reset --hard HEAD~1`)
    process.exit(1)
}
run('git', ['push', '--follow-tags'])
