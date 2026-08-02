import Stripe from 'stripe';
import { STRIPE_SECRET_KEY } from '$env/static/private';

if (!STRIPE_SECRET_KEY) {
	throw new Error('STRIPE_SECRET_KEY is not set in environment variables');
}

export const stripe = new Stripe(STRIPE_SECRET_KEY, {
	apiVersion: '2025-10-29.clover'
});
