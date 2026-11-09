import {
    ApplicationConfig,
    isDevMode,
    provideBrowserGlobalErrorListeners,
    provideZoneChangeDetection
} from '@angular/core';
import { provideDevtoolsConfig } from '@angular-architects/ngrx-toolkit';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { providePrimeNG } from 'primeng/config';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import Aura from '@primeng/themes/aura';

import {
    CURRENT_APPLICATION,
    SUPPORT_EMAIL_ADDRESS,
    TargetApplication
} from './project-documents/tokens/shared-ui';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
    providers: [
        provideBrowserGlobalErrorListeners(),
        provideZoneChangeDetection({ eventCoalescing: true }),
        ...isDevMode() ? [provideDevtoolsConfig({ name: 'X36 File Manager' })] : [],
        provideHttpClient(),
        // Supplied once by the application, as the shared popup service expects.
        { provide: CURRENT_APPLICATION, useValue: TargetApplication.PROJECTS },
        { provide: SUPPORT_EMAIL_ADDRESS, useValue: 'support@example.invalid' },
        provideRouter(routes),
        provideAnimationsAsync(),
        providePrimeNG({
            theme: {
                preset: Aura,
                options: {
                    darkModeSelector: '.dark'
                }
            }
        })
    ]
};
