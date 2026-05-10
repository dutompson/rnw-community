import { TurboModuleRegistry } from 'react-native';

import type { TurboModule } from 'react-native';

/*
 * TODO: Codegen does not support anything from TS unfortunately
 * https://reactnative.dev/docs/new-architecture-appendix#iii-typescript-to-native-type-mapping
 * Unions do not work, objects do not work, generics do not work, etc.
 */
export interface Spec extends TurboModule {
    abort: () => Promise<void>;
    canMakePayments: (methodData: string) => Promise<boolean>;
    complete: (paymentComplete: string) => Promise<void>;
    show: (methodData: string, details: object) => Promise<string>;
    updatePaymentItems: (details: object) => Promise<void>;
    updateShippingContact: (details: object, shippingMethods: object, errors: object) => Promise<void>;
    updateShippingMethod: (details: object) => Promise<void>;
    updateCouponCode: (details: object, shippingMethods: object, errors: object) => Promise<void>;
    addListener: (eventName: string) => void;
    removeListeners: (count: number) => void;
}

// ts-prune-ignore-next
export default TurboModuleRegistry.get<Spec>('Payments');
