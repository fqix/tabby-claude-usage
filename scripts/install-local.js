// Copy the built plugin into Tabby's user plugins directory.
const fs = require('fs')
const os = require('os')
const path = require('path')

const root = path.join(__dirname, '..')
// Tabby's userData dir (Electron app.getPath('userData')) per platform.
const userData = {
    darwin: path.join(os.homedir(), 'Library', 'Application Support', 'tabby'),
    win32: path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'tabby'),
}[process.platform] || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'tabby')
const dest = path.join(userData, 'plugins', 'node_modules', 'tabby-claude-usage')

fs.rmSync(dest, { recursive: true, force: true })
fs.mkdirSync(dest, { recursive: true })
fs.copyFileSync(path.join(root, 'package.json'), path.join(dest, 'package.json'))
fs.cpSync(path.join(root, 'dist'), path.join(dest, 'dist'), { recursive: true })
console.log(`Installed to ${dest}\nRestart Tabby to load it.`)
