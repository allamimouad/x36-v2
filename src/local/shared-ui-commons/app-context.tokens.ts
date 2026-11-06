import { InjectionToken } from '@angular/core';

/** The portal application a shared component is running inside. */
export enum IBPortalTargetApplication {
    PROJECTS = 'PROJECTS'
}

/**
 * Supplied once by the application, and injected by shared services that need to know
 * which portal they are running in. Nothing provides it in the root injector, so a test
 * module that builds a component reaching this service has to provide it too.
 */
export const CURRENT_APP_INJECTION_TOKEN =
    new InjectionToken<IBPortalTargetApplication>('CurrentAppInjectionToken');

/** The address an error report tells the user to contact. Supplied alongside the above. */
export const IB_PORTAL_SUPPORT_EMAIL_ADDRESS_INJECTION_TOKEN =
    new InjectionToken<string>('IBPortalSupportEmailAddressInjectionToken');
