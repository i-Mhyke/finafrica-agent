import type { Market, SourceTier } from './schemas';
import { MANDATORY_MARKETS } from './schemas';

export { MANDATORY_MARKETS };

export const VERTICALS = [
	'monetary-policy',
	'banking-regulation',
	'bank-performance',
	'capital-markets',
	'capital-flows',
	'payments-infrastructure',
	'identity-fraud-cyber',
	'open-banking-ai-apis',
	'fintech-strategy',
	'human-behaviour-signals',
] as const;

export type Vertical = (typeof VERTICALS)[number];

export interface MarketPolicy {
	market: Market;
	displayName: string;
	currency: string;
	tier1Domains: string[];
	tier2Domains: string[];
	prWireDomains: string[];
}

export const MARKET_POLICIES: Record<Market, MarketPolicy> = {
	nigeria: {
		market: 'nigeria',
		displayName: 'Nigeria',
		currency: 'NGN',
		tier1Domains: [
			'cbn.gov.ng',
			'sec.gov.ng',
			'ngxgroup.com',
			'fmdqgroup.com',
			'ndic.gov.ng',
			'pencom.gov.ng',
			'firs.gov.ng',
		],
		tier2Domains: [
			'businessday.ng',
			'nairametrics.com',
			'proshare.co',
			'thisdaylive.com',
			'premiumtimesng.com',
		],
		prWireDomains: ['prnewswire.com', 'businesswire.com', 'globenewswire.com'],
	},
	kenya: {
		market: 'kenya',
		displayName: 'Kenya',
		currency: 'KES',
		tier1Domains: [
			'centralbank.go.ke',
			'cma.or.ke',
			'nse.co.ke',
			'kra.go.ke',
			'treasury.go.ke',
		],
		tier2Domains: [
			'businesdailyafrica.com',
			'the-star.co.ke',
			'standardmedia.co.ke',
			'theexchange.africa',
		],
		prWireDomains: ['prnewswire.com', 'businesswire.com', 'globenewswire.com'],
	},
	ghana: {
		market: 'ghana',
		displayName: 'Ghana',
		currency: 'GHS',
		tier1Domains: [
			'bog.gov.gh',
			'sec.gov.gh',
			'gse.com.gh',
			'gra.gov.gh',
			'finance.gov.gh',
		],
		tier2Domains: [
			'graphic.com.gh',
			'myjoyonline.com',
			'citinewsroom.com',
			'thebftonline.com',
		],
		prWireDomains: ['prnewswire.com', 'businesswire.com', 'globenewswire.com'],
	},
	'south-africa': {
		market: 'south-africa',
		displayName: 'South Africa',
		currency: 'ZAR',
		tier1Domains: [
			'resbank.co.za',
			'fsca.co.za',
			'jse.co.za',
			'sars.gov.za',
			'treasury.gov.za',
			'statssa.gov.za',
		],
		tier2Domains: [
			'businesslive.co.za',
			'moneyweb.co.za',
			'fin24.com',
			'dailymaverick.co.za',
		],
		prWireDomains: ['prnewswire.com', 'businesswire.com', 'globenewswire.com'],
	},
	egypt: {
		market: 'egypt',
		displayName: 'Egypt',
		currency: 'EGP',
		tier1Domains: [
			'cbe.org.eg',
			'fra.gov.eg',
			'egx.com.eg',
			'finance.gov.eg',
			'capmas.gov.eg',
		],
		tier2Domains: [
			'enterprise.press',
			'dailynewsegypt.com',
			'ahram.org.eg',
			'zawya.com',
		],
		prWireDomains: ['prnewswire.com', 'businesswire.com', 'globenewswire.com'],
	},
};

const GLOBAL_TIER1_DOMAINS = [
	'imf.org',
	'worldbank.org',
	'ifc.org',
	'afdb.org',
	'proparco.fr',
	'bii.co.uk',
];

const GLOBAL_TIER2_DOMAINS = [
	'reuters.com',
	'bloomberg.com',
	'ft.com',
	'african.business',
	'africanbanker.com',
	'techcabal.com',
];

const SOCIAL_DOMAINS = ['linkedin.com', 'twitter.com', 'x.com'];

export function getTier1Domains(market: Market): readonly string[] {
	return MARKET_POLICIES[market].tier1Domains;
}

export function getAllowedDomains(market: Market, tier: SourceTier): string[] {
	const policy = MARKET_POLICIES[market];
	switch (tier) {
		case 1:
			return [...policy.tier1Domains, ...GLOBAL_TIER1_DOMAINS];
		case 2:
			return [...policy.tier2Domains, ...GLOBAL_TIER2_DOMAINS];
		case 3:
			return SOCIAL_DOMAINS;
	}
}

export interface SourceClassification {
	tier: SourceTier;
	sourceType: 'primary' | 'secondary' | 'social';
	isPrWire: boolean;
}

export function classifySource(url: string, market: Market): SourceClassification {
	const hostname = new URL(url).hostname.replace(/^www\./, '');
	const policy = MARKET_POLICIES[market];

	if (policy.prWireDomains.some((d) => hostname === d || hostname.endsWith(`.${d}`))) {
		return { tier: 2, sourceType: 'secondary', isPrWire: true };
	}

	if (SOCIAL_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`))) {
		return { tier: 3, sourceType: 'social', isPrWire: false };
	}

	if (
		[...policy.tier1Domains, ...GLOBAL_TIER1_DOMAINS].some(
			(d) => hostname === d || hostname.endsWith(`.${d}`),
		)
	) {
		return { tier: 1, sourceType: 'primary', isPrWire: false };
	}

	if (
		[...policy.tier2Domains, ...GLOBAL_TIER2_DOMAINS].some(
			(d) => hostname === d || hostname.endsWith(`.${d}`),
		)
	) {
		return { tier: 2, sourceType: 'secondary', isPrWire: false };
	}

	return { tier: 2, sourceType: 'secondary', isPrWire: false };
}
