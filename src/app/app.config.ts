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
} from '../local/shared-ui-commons/app-context.tokens';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
    providers: [
        provideBrowserGlobalErrorListeners(),
        provideZoneChangeDetection({ eventCoalescing: true }),
        ...isDevMode() ? [provideDevtoolsConfig({ name: 'X36 File Manager' })] : [],
        provideHttpClient(),
        // Supplied once by the application, as the shared popup service expects.
        // Imported from the module that defines them rather than the package barrel:
        // the barrel also re-exports the popup service, so asking it for two tokens
        // pulls that service and PrimeNG's dynamic dialog into the initial bundle.
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
