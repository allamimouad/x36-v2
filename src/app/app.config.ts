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
    CURRENT_APP_INJECTION_TOKEN,
    IB_PORTAL_SUPPORT_EMAIL_ADDRESS_INJECTION_TOKEN,
    IBPortalTargetApplication
} from 'ibportal-web-ui-commons';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
    providers: [
        provideBrowserGlobalErrorListeners(),
        provideZoneChangeDetection({ eventCoalescing: true }),
        ...isDevMode() ? [provideDevtoolsConfig({ name: 'X36 File Manager' })] : [],
        provideHttpClient(),
        // Supplied once by the application, as the shared popup service expects.
        {
            provide: CURRENT_APP_INJECTION_TOKEN,
            useValue: IBPortalTargetApplication.PROJECTS
        },
        {
            provide: IB_PORTAL_SUPPORT_EMAIL_ADDRESS_INJECTION_TOKEN,
            useValue: 'support@example.invalid'
        },
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
