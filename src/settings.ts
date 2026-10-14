import { Component, HostBinding, Injectable } from '@angular/core'
import { ConfigService } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'
import { FORMAT_PLACEHOLDERS } from './config'

const TOGGLES: [key: string, title: string, description: string][] = [
    ['showBrand', 'Show "✳ Claude" label', ''],
    ['showSession', 'Show session (5h) limit', ''],
    ['showWeekly', 'Show weekly limit', 'All models'],
    ['showModelWeekly', 'Show model-specific weekly limit', 'The tightest one, e.g. Sonnet / Opus'],
    ['showExtraUsage', 'Show extra usage spend', 'Only when extra usage is enabled on your account'],
    ['showMeters', 'Show progress meters', ''],
    ['showResetTime', 'Show time until reset', ''],
    ['showLastUpdated', 'Show last refresh time', ''],
]

/** @hidden */
@Component({
    template: `
<h3>Claude Usage</h3>

<div class="form-line">
    <div class="header">
        <div class="title">Show status bar</div>
        <div class="description">Claude subscription usage at the bottom of the window</div>
    </div>
    <toggle [(ngModel)]="cfg.enabled" (ngModelChange)="save()"></toggle>
</div>

<ng-container *ngIf="cfg.enabled">
    <div class="form-line">
        <div class="header">
            <div class="title">Alignment</div>
        </div>
        <select class="form-control" [(ngModel)]="cfg.align" (ngModelChange)="save()">
            <option value="left">Left</option>
            <option value="right">Right</option>
        </select>
    </div>

    <div class="form-line">
        <div class="header">
            <div class="title">Refresh interval (minutes)</div>
            <div class="description">The usage endpoint is rate limited; 5 minutes or more is recommended</div>
        </div>
        <input class="form-control" type="number" min="1" max="120" [(ngModel)]="cfg.refreshInterval" (ngModelChange)="save()">
    </div>

    <div class="form-line">
        <div class="header">
            <div class="title">Warning threshold (%)</div>
            <div class="description">Usage turns yellow at this level</div>
        </div>
        <input class="form-control" type="number" min="0" max="100" [(ngModel)]="cfg.warnThreshold" (ngModelChange)="save()">
    </div>

    <div class="form-line">
        <div class="header">
            <div class="title">Critical threshold (%)</div>
            <div class="description">Usage turns red at this level</div>
        </div>
        <input class="form-control" type="number" min="0" max="100" [(ngModel)]="cfg.criticalThreshold" (ngModelChange)="save()">
    </div>

    <h3 class="mt-4">Items</h3>

    <div class="form-line" *ngIf="cfg.format">
        <div class="header">
            <div class="description">A custom format is set below, so these toggles are ignored.</div>
        </div>
    </div>

    <div class="form-line" *ngFor="let t of toggles" [class.disabled]="!!cfg.format">
        <div class="header">
            <div class="title">{{ t[1] }}</div>
            <div class="description" *ngIf="t[2]">{{ t[2] }}</div>
        </div>
        <toggle [(ngModel)]="cfg[t[0]]" (ngModelChange)="save()"></toggle>
    </div>

    <h3 class="mt-4">Custom format</h3>

    <div class="form-line">
        <div class="header">
            <div class="title">Format</div>
            <div class="description">Leave empty to use the items above. Example: <code>✳ 5h {{ '{' }}session{{ '}' }} · 7d {{ '{' }}weekly{{ '}' }} ↻{{ '{' }}weekly_reset{{ '}' }}</code></div>
        </div>
    </div>
    <input class="form-control" type="text" placeholder="(default layout)" [(ngModel)]="cfg.format" (ngModelChange)="save()">

    <table class="table table-sm mt-2 placeholders">
        <tr *ngFor="let p of placeholders">
            <td><code>{{ p[0] }}</code></td>
            <td>{{ p[1] }}</td>
        </tr>
    </table>
</ng-container>
`,
    styles: [`
        .placeholders td { padding: 2px 12px 2px 0; border: none; opacity: .8; }
        .form-line.disabled { opacity: .4; }
    `],
})
export class ClaudeUsageSettingsTabComponent {
    toggles = TOGGLES
    placeholders = FORMAT_PLACEHOLDERS

    @HostBinding('class.content-box') contentBox = true

    constructor (public config: ConfigService) { }

    get cfg (): any {
        return this.config.store.claudeUsage
    }

    save (): void {
        void this.config.save()
    }
}

/** @hidden */
@Injectable()
export class ClaudeUsageSettingsTabProvider extends SettingsTabProvider {
    id = 'claude-usage'
    icon = 'chart-bar'
    title = 'Claude Usage'

    getComponentType (): any {
        return ClaudeUsageSettingsTabComponent
    }
}
