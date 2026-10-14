import { NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import TabbyCoreModule, { ConfigProvider, ConfigService } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'

import { ClaudeUsageConfigProvider } from './config'
import { ClaudeUsageSettingsTabComponent, ClaudeUsageSettingsTabProvider } from './settings'
import { ClaudeUsageBar } from './statusBar'

declare global {
    interface Window { __claudeUsageBar?: ClaudeUsageBar }
}

/** Tabby plugin entry: shows Claude subscription usage in a bottom status bar. */
@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        TabbyCoreModule,
    ],
    providers: [
        { provide: ConfigProvider, useClass: ClaudeUsageConfigProvider, multi: true },
        { provide: SettingsTabProvider, useClass: ClaudeUsageSettingsTabProvider, multi: true },
    ],
    declarations: [
        ClaudeUsageSettingsTabComponent,
    ],
})
export default class ClaudeUsageModule {
    constructor (config: ConfigService) {
        if (window.__claudeUsageBar) {
            return
        }
        const bar = window.__claudeUsageBar = new ClaudeUsageBar(() => config.store?.claudeUsage)
        config.ready$.subscribe(() => bar.start())
        config.changed$.subscribe(() => bar.configChanged())
    }
}
