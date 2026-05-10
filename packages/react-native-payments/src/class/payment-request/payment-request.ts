/* eslint-disable max-lines */
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import uuid from 'react-native-uuid';

import { emptyFn, isDefined, isNotEmptyArray, isNotEmptyString } from '@rnw-community/shared';

import { AndroidPaymentMethodTokenizationType } from '../../@standard/android/enum/android-payment-method-tokenization-type.enum';
import { defaultAndroidPaymentDataRequest } from '../../@standard/android/request/android-payment-data-request';
import { defaultAndroidPaymentMethod } from '../../@standard/android/request/android-payment-method';
import { defaultAndroidTransactionInfo } from '../../@standard/android/request/android-transaction-info';
import { IOSPKContactField } from '../../@standard/ios/enum/ios-pk-contact-field.enum';
import { IosPKMerchantCapability } from '../../@standard/ios/enum/ios-pk-merchant-capability.enum';
import { IosPKPaymentNetworksEnum } from '../../@standard/ios/enum/ios-pk-payment-networks.enum';
import { PaymentMethodNameEnum } from '../../enum/payment-method-name.enum';
import { PaymentsErrorEnum } from '../../enum/payments-error.enum';
import { SupportedNetworkEnum } from '../../enum/supported-networks.enum';
import { ConstructorError } from '../../error/constructor.error';
import { DOMException } from '../../error/dom.exception';
import { PaymentsError } from '../../error/payments.error';
import { validateDisplayItems } from '../../util/validate-display-items.util';
import { validatePaymentMethods } from '../../util/validate-payment-methods.util';
import { validateTotal } from '../../util/validate-total.util';
import { NativePayments } from '../native-payments/native-payments';
import { AndroidPaymentResponse } from '../payment-response/android-payment-response';
import { IosPaymentResponse } from '../payment-response/ios-payment-response';

import type { AndroidAllowedCardNetworksEnum } from '../../@standard/android/enum/android-allowed-card-networks.enum';
import type { AndroidPaymentMethodDataDataInterface } from '../../@standard/android/mapping/android-payment-method-data-data.interface';
import type { AndroidPaymentDataRequest } from '../../@standard/android/request/android-payment-data-request';
import type { IosPaymentMethodDataDataInterface } from '../../@standard/ios/mapping/ios-payment-method-data-data.interface';
import type { IosPaymentDataRequest } from '../../@standard/ios/request/ios-payment-data-request';
import type { IosPKContact } from '../../@standard/ios/response/ios-pk-contact';
import type { IosPKShippingMethod } from '../../@standard/ios/response/ios-pk-shipping-method';
import type { PaymentDetailsInit } from '../../@standard/w3c/payment-details-init';
import type { PaymentMethodData } from '../../@standard/w3c/payment-method-data';
import type { PaymentRequestUpdateResult } from '../../type/payment-request-update-result/payment-request-update-result.type';
import type { EmitterSubscription, NativeModule } from 'react-native';

export interface PaymentMethodChangeEvent {
    type: string;
    network: string;
    displayName: string;
}

export interface CouponCodeChangeEvent {
    couponCode: string;
}

/*
 * HINT: Troubleshooting: https://developers.google.com/pay/api/android/support/troubleshooting
 * HINT: Google Pay API Errors: https://developers.google.com/pay/api/web/reference/error-objects
 */
export class PaymentRequest {
    // https://www.w3.org/TR/payment-request/#id-attribute
    readonly id: string;
    updating = false;
    state: 'closed' | 'created' | 'interactive' = 'created';

    // Internal Slots https://www.w3.org/TR/payment-request/#internal-slots
    private readonly serializedMethodData: string;
    private readonly platformMethodData: AndroidPaymentMethodDataDataInterface | IosPaymentMethodDataDataInterface;

    private acceptPromiseRejecter: (reason: unknown) => void = emptyFn;

    private paymentMethodChangeSubscription: EmitterSubscription | null = null;
    private paymentMethodChangeCallback: ((event: PaymentMethodChangeEvent) => PaymentDetailsInit) | null = null;

    private shippingContactChangeSubscription: EmitterSubscription | null = null;
    private shippingContactChangeCallback: ((event: IosPKContact) => PaymentRequestUpdateResult) | null = null;

    private shippingMethodChangeSubscription: EmitterSubscription | null = null;
    private shippingMethodChangeCallback: ((event: IosPKShippingMethod) => PaymentRequestUpdateResult) | null = null;

    private couponCodeChangeSubscription: EmitterSubscription | null = null;
    private couponCodeChangeCallback: ((event: CouponCodeChangeEvent) => PaymentRequestUpdateResult) | null = null;

     
    constructor(
        readonly methodData: PaymentMethodData[],
        public details: PaymentDetailsInit
    ) {
        // 3. Establish the request's id:
        if (!isNotEmptyString(details.id)) {
            // TODO: Can we avoid using external lib? Use Math.random?

            details.id = uuid.v4();
        }
        this.id = details.id;

        // 4. Process payment methods
        validatePaymentMethods(methodData);

        // 5. Process the total
        validateTotal(details.total, ConstructorError);

        // 6. If the displayItems member of details is present, then for each item in details.displayItems:
        validateDisplayItems(details.displayItems, ConstructorError);

        // 17. Set request.[[serializedMethodData]] to serializedMethodData.         */
        this.platformMethodData = this.findPlatformPaymentMethodData();

        const nativePlatformMethodData =
            Platform.OS === 'android'
                ? this.getAndroidPaymentMethodData(this.platformMethodData as AndroidPaymentMethodDataDataInterface, details)
                : this.getIosPaymentMethodData(this.platformMethodData as IosPaymentMethodDataDataInterface);

        this.serializedMethodData = JSON.stringify(nativePlatformMethodData);
    }

    // https://www.w3.org/TR/payment-request/#canmakepayment-method
    async canMakePayment(): Promise<boolean> {
        if (this.state !== 'created') {
            throw new DOMException(PaymentsErrorEnum.InvalidStateError);
        }

        return NativePayments.canMakePayments(this.serializedMethodData);
    }

    // https://www.w3.org/TR/payment-request/#show-method
    show(): Promise<AndroidPaymentResponse | IosPaymentResponse> {
        return new Promise<AndroidPaymentResponse | IosPaymentResponse>((resolve, reject) => {
            this.acceptPromiseRejecter = reject;

            if (this.state === 'created') {
                this.state = 'interactive';

                // HINT: We need to pass Android environment configuration to native module via details
                const details =
                    Platform.OS === 'android'
                        ? {
                              ...this.details,
                              environment: (this.platformMethodData as AndroidPaymentMethodDataDataInterface).environment,
                          }
                        : this.details;

                NativePayments.show(this.serializedMethodData, details)
                    .then(jsonDetails => {
                        this.cleanupListeners();
                        resolve(this.handleAccept(jsonDetails));

                        return void 0;
                    })

                    .catch((error: unknown) => {
                        this.cleanupListeners();
                        reject(error instanceof Error ? error : new Error(String(error)));
                    });
            } else {
                reject(new DOMException(PaymentsErrorEnum.InvalidStateError));
            }
        });
    }

    // https://www.w3.org/TR/payment-request/#abort-method
    async abort(): Promise<void> {
        if (this.state !== 'interactive') {
            throw new DOMException(PaymentsErrorEnum.InvalidStateError);
        }

        await NativePayments.abort().catch(() => {
            throw new PaymentsError(`Failed aborting PaymentRequest`);
        });

        this.state = 'closed';

        this.acceptPromiseRejecter(new DOMException(PaymentsErrorEnum.AbortError));
    }

    // Register a callback for Apple Pay payment method changes (credit/debit selection)
    onPaymentMethodChange(
        callback: (event: PaymentMethodChangeEvent) => PaymentDetailsInit
    ): void {
        this.paymentMethodChangeCallback = callback;

        if (Platform.OS !== 'ios') {
            return;
        }

        const eventEmitter = this.getPaymentsEventEmitter();
        this.paymentMethodChangeSubscription = eventEmitter.addListener(
            'onPaymentMethodChange',
            (event: PaymentMethodChangeEvent) => {
                if (!this.paymentMethodChangeCallback) {
                    return;
                }

                const updatedDetails = this.paymentMethodChangeCallback(event);
                this.details = updatedDetails;
                NativePayments.updatePaymentItems(updatedDetails).catch(emptyFn);
            }
        );
    }

    onShippingContactChange(callback: (event: IosPKContact) => PaymentRequestUpdateResult): void {
        this.shippingContactChangeCallback = callback;

        if (Platform.OS !== 'ios') {
            return;
        }

        const eventEmitter = this.getPaymentsEventEmitter();
        this.shippingContactChangeSubscription = eventEmitter.addListener(
            'onShippingContactChange',
            (event: IosPKContact) => {
                if (!this.shippingContactChangeCallback) {
                    return;
                }

                const result = this.shippingContactChangeCallback(event);
                this.details = result.details;

                NativePayments.updateShippingContact(
                    result.details,
                    result.shippingMethods ?? [],
                    result.errors ?? []
                ).catch(emptyFn);
            }
        );
    }

    onShippingMethodChange(callback: (event: IosPKShippingMethod) => PaymentRequestUpdateResult): void {
        this.shippingMethodChangeCallback = callback;

        if (Platform.OS !== 'ios') {
            return;
        }

        const eventEmitter = this.getPaymentsEventEmitter();
        this.shippingMethodChangeSubscription = eventEmitter.addListener(
            'onShippingMethodChange',
            (event: IosPKShippingMethod) => {
                if (!this.shippingMethodChangeCallback) {
                    return;
                }

                const result = this.shippingMethodChangeCallback(event);
                this.details = result.details;
                NativePayments.updateShippingMethod(result.details).catch(emptyFn);
            }
        );
    }

    onCouponCodeChange(callback: (event: CouponCodeChangeEvent) => PaymentRequestUpdateResult): void {
        this.couponCodeChangeCallback = callback;

        if (Platform.OS !== 'ios') {
            return;
        }

        const eventEmitter = this.getPaymentsEventEmitter();
        this.couponCodeChangeSubscription = eventEmitter.addListener(
            'onCouponCodeChange',
            (event: CouponCodeChangeEvent) => {
                if (!this.couponCodeChangeCallback) {
                    return;
                }

                const result = this.couponCodeChangeCallback(event);
                this.details = result.details;

                NativePayments.updateCouponCode(
                    result.details,
                    result.shippingMethods ?? [],
                    result.errors ?? []
                ).catch(emptyFn);
            }
        );
    }

    private getPaymentsNativeModule(): NativeModule | undefined {
        const modules = NativeModules as unknown as { Payments?: NativeModule };

        return modules.Payments;
    }

    private getPaymentsEventEmitter(): NativeEventEmitter {
        return new NativeEventEmitter(this.getPaymentsNativeModule());
    }

    private cleanupSubscription(subscription: EmitterSubscription | null): null {
        if (subscription) {
            subscription.remove();
        }

        return null;
    }

    private cleanupListeners(): void {
        this.paymentMethodChangeSubscription = this.cleanupSubscription(this.paymentMethodChangeSubscription);
        this.paymentMethodChangeCallback = null;

        this.shippingContactChangeSubscription = this.cleanupSubscription(this.shippingContactChangeSubscription);
        this.shippingContactChangeCallback = null;

        this.shippingMethodChangeSubscription = this.cleanupSubscription(this.shippingMethodChangeSubscription);
        this.shippingMethodChangeCallback = null;

        this.couponCodeChangeSubscription = this.cleanupSubscription(this.couponCodeChangeSubscription);
        this.couponCodeChangeCallback = null;
    }

    private handleAccept(details: string): AndroidPaymentResponse | IosPaymentResponse {
        try {
            return Platform.OS === 'android'
                ? new AndroidPaymentResponse(this.id, PaymentMethodNameEnum.AndroidPay, details)
                : new IosPaymentResponse(this.id, PaymentMethodNameEnum.ApplePay, details);
        } catch (_e) {
            // TODO: Is there an standard exception for this?
            throw new PaymentsError(`Failed parsing PaymentRequest details`);
        }
    }

    private findPlatformPaymentMethodData(): AndroidPaymentMethodDataDataInterface | IosPaymentMethodDataDataInterface {
        const platformSupportedMethod =
            Platform.OS === 'ios' ? PaymentMethodNameEnum.ApplePay : PaymentMethodNameEnum.AndroidPay;

        const platformMethod = this.methodData.find(
            paymentMethodData => paymentMethodData.supportedMethods === platformSupportedMethod
        );

        if (!isDefined(platformMethod)) {
            throw new DOMException(PaymentsErrorEnum.NotSupportedError);
        }

        return platformMethod.data;
    }

     
    private getAndroidPaymentMethodData(
        methodData: AndroidPaymentMethodDataDataInterface,
        details: PaymentDetailsInit
    ): AndroidPaymentDataRequest {
        const isBillingRequired =
            methodData.requestBillingAddress === true ||
            methodData.requestPayerName === true ||
            methodData.requestPayerPhone === true;

        return {
            ...defaultAndroidPaymentDataRequest,
            merchantInfo: {
                merchantName: details.total.label,
            },
            transactionInfo: {
                ...defaultAndroidTransactionInfo,
                currencyCode: methodData.currencyCode,
                totalPrice: details.total.amount.value,
                totalPriceLabel: details.total.label,
                countryCode: methodData.countryCode,
            },
            allowedPaymentMethods: [
                {
                    ...defaultAndroidPaymentMethod,
                    parameters: {
                        ...defaultAndroidPaymentMethod.parameters,
                        allowedCardNetworks: methodData.supportedNetworks.map(
                            network => network.toUpperCase() as AndroidAllowedCardNetworksEnum
                        ),
                        allowedAuthMethods:
                            methodData.allowedAuthMethods ?? defaultAndroidPaymentMethod.parameters.allowedAuthMethods,
                        ...(isBillingRequired && {
                            billingAddressRequired: true,
                            billingAddressParameters: {
                                format: methodData.requestBillingAddress === true ? 'FULL' : 'MIN',
                                phoneNumberRequired: methodData.requestPayerPhone === true,
                            },
                        }),
                    },
                    ...(isDefined(methodData.gatewayConfig) && {
                        tokenizationSpecification: {
                            parameters: methodData.gatewayConfig,
                            type: AndroidPaymentMethodTokenizationType.PAYMENT_GATEWAY,
                        },
                    }),
                    ...(isDefined(methodData.directConfig) && {
                        tokenizationSpecification: {
                            parameters: methodData.directConfig,
                            type: AndroidPaymentMethodTokenizationType.DIRECT,
                        },
                    }),
                },
            ],
            ...(methodData.requestPayerEmail === true && { emailRequired: true }),
            ...(methodData.requestShipping === true && {
                shippingAddressRequired: true,
                shippingAddressParameters: {
                    phoneNumberRequired: methodData.requestPayerPhone === true,
                },
            }),
        };
    }

     
    private getIosPaymentMethodData(methodData: IosPaymentMethodDataDataInterface): IosPaymentDataRequest {
        // TODO: Add mappings for other systems if needed
        const supportedNetworkMap: Record<SupportedNetworkEnum, IosPKPaymentNetworksEnum> = {
            [SupportedNetworkEnum.Amex]: IosPKPaymentNetworksEnum.PKPaymentNetworkAmex,
            [SupportedNetworkEnum.Mastercard]: IosPKPaymentNetworksEnum.PKPaymentNetworkMasterCard,
            [SupportedNetworkEnum.Visa]: IosPKPaymentNetworksEnum.PKPaymentNetworkVisa,
            [SupportedNetworkEnum.Discover]: IosPKPaymentNetworksEnum.PKPaymentNetworkDiscover,
            [SupportedNetworkEnum.Bancontact]: IosPKPaymentNetworksEnum.PKPaymentNetworkBancontact,
            [SupportedNetworkEnum.CartesBancaires]: IosPKPaymentNetworksEnum.PKPaymentNetworkCartesBancaires,
            [SupportedNetworkEnum.ChinaUnionPay]: IosPKPaymentNetworksEnum.PKPaymentNetworkChinaUnionPay,
            [SupportedNetworkEnum.Dankort]: IosPKPaymentNetworksEnum.PKPaymentNetworkDankort,
            [SupportedNetworkEnum.Eftpos]: IosPKPaymentNetworksEnum.PKPaymentNetworkEftpos,
            [SupportedNetworkEnum.Electron]: IosPKPaymentNetworksEnum.PKPaymentNetworkElectron,
            [SupportedNetworkEnum.Elo]: IosPKPaymentNetworksEnum.PKPaymentNetworkElo,
            [SupportedNetworkEnum.Girocard]: IosPKPaymentNetworksEnum.PKPaymentNetworkGirocard,
            [SupportedNetworkEnum.Interac]: IosPKPaymentNetworksEnum.PKPaymentNetworkInterac,
            [SupportedNetworkEnum.Jcb]: IosPKPaymentNetworksEnum.PKPaymentNetworkJCB,
            [SupportedNetworkEnum.Mada]: IosPKPaymentNetworksEnum.PKPaymentNetworkMada,
            [SupportedNetworkEnum.Maestro]: IosPKPaymentNetworksEnum.PKPaymentNetworkMaestro,
            [SupportedNetworkEnum.Mir]: IosPKPaymentNetworksEnum.PKPaymentNetworkMir,
            [SupportedNetworkEnum.PrivateLabel]: IosPKPaymentNetworksEnum.PKPaymentNetworkPrivateLabel,
            [SupportedNetworkEnum.Vpay]: IosPKPaymentNetworksEnum.PKPaymentNetworkVPay,
        };

        const defaultMerchantCapabilities = [
            IosPKMerchantCapability.PKMerchantCapability3DS,
            IosPKMerchantCapability.PKMerchantCapabilityDebit,
            IosPKMerchantCapability.PKMerchantCapabilityCredit,
        ];

        const requestedShippingFields = this.getRequestedShippingFields(methodData);

        const isShippingRequested = requestedShippingFields.length > 0;

        return {
            countryCode: methodData.countryCode,
            currencyCode: methodData.currencyCode,
            merchantIdentifier: methodData.merchantIdentifier,
            supportedNetworks: methodData.supportedNetworks.map(network => supportedNetworkMap[network]),
            merchantCapabilities: isNotEmptyArray(methodData.merchantCapabilities)
                ? methodData.merchantCapabilities
                : defaultMerchantCapabilities,
            ...(methodData.requestBillingAddress === true && {
                requiredBillingContactFields: this.getRequestedBillingFields(methodData),
            }),
            ...(isShippingRequested && { requiredShippingContactFields: requestedShippingFields }),
            ...(isDefined(methodData.applicationData) && { applicationData: methodData.applicationData }),
        };
    }

     
    private getRequestedBillingFields(methodData: IosPaymentMethodDataDataInterface): IOSPKContactField[] {
        const requiredBillingFields: IOSPKContactField[] = [];
        if (methodData.requestBillingAddress ?? false) {
            requiredBillingFields.push(IOSPKContactField.PKContactFieldPostalAddress);
        }

        return requiredBillingFields;
    }

     
    private getRequestedShippingFields(methodData: IosPaymentMethodDataDataInterface): IOSPKContactField[] {
        const requiredShippingFields: IOSPKContactField[] = [];
        if (methodData.requestPayerEmail ?? false) {
            requiredShippingFields.push(IOSPKContactField.PKContactFieldEmailAddress);
        }
        if (methodData.requestPayerName ?? false) {
            requiredShippingFields.push(IOSPKContactField.PKContactFieldName);
        }
        if (methodData.requestPayerPhone ?? false) {
            requiredShippingFields.push(IOSPKContactField.PKContactFieldPhoneNumber);
        }
        if (methodData.requestShipping ?? false) {
            requiredShippingFields.push(IOSPKContactField.PKContactFieldPostalAddress);
        }

        return requiredShippingFields;
    }
}
