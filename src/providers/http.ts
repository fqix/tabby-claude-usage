import * as os from 'os'
import * as http from 'http'
import * as https from 'https'
import { execFile } from 'child_process'
import { UsageError } from './types'

export interface HttpResponse { status: number, headers: Record<string, string | string[] | undefined>, body: string }

export function httpRequest (method: string, url: string, headers: Record<string, string>, body?: string): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('http:') ? http : https
        const req = client.request(url, { method, headers, timeout: 30000 }, res => {
            let data = ''
            res.setEncoding('utf-8')
            res.on('data', (c: string) => { data += c })
            res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }))
        })
        req.on('timeout', () => req.destroy(new Error('Request timed out')))
        req.on('error', e => reject(new UsageError('network', `Network error: ${e.message}`)))
        req.end(body)
    })
}

export const httpGet = (url: string, headers: Record<string, string>): Promise<HttpResponse> => httpRequest('GET', url, headers)

export function retryAfterMs (header: string | string[] | undefined): number | null {
    if (typeof header !== 'string' || !header) {
        return null
    }
    const secs = Number(header)
    if (Number.isFinite(secs)) {
        return secs * 1000
    }
    const date = Date.parse(header)
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}

/**
 * Run a CLI command. On macOS/Linux it goes through the user's login shell so PATH includes
 * npm/homebrew bins even when Tabby is launched from the desktop; on Windows through cmd.exe.
 */
export function runCli (command: string, timeout: number): Promise<{ ok: boolean, stdout: string }> {
    return new Promise(resolve => {
        const done = (err: Error | null, stdout: string): void => resolve({ ok: !err, stdout: stdout || '' })
        if (process.platform === 'win32') {
            execFile(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command], { timeout, cwd: os.tmpdir(), windowsHide: true }, done)
        } else {
            const shell = process.env.SHELL ?? (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh')
            execFile(shell, ['-lc', command], { timeout, cwd: os.tmpdir() }, done)
        }
    })
}
