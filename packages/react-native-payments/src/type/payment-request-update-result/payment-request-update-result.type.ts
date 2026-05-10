import type { IosPKShippingMethod } from '../../@standard/ios/response/ios-pk-shipping-method';
import type { PaymentDetailsInit } from '../../@standard/w3c/payment-details-init';
import type { PaymentRequestUpdateError } from '../payment-request-update-error/payment-request-update-error.type';

export interface PaymentRequestUpdateResult {
    details: PaymentDetailsInit;
    shippingMethods?: IosPKShippingMethod[];
    errors?: PaymentRequestUpdateError[];
}

