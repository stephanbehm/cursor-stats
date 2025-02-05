import axios from 'axios';
import { CursorStats, UsageLimitResponse, ExtendedAxiosError, UsageItem } from '../interfaces/types';
import { log } from '../utils/logger';

export async function getCurrentUsageLimit(token: string): Promise<UsageLimitResponse> {
    try {
        const response = await axios.post('https://www.cursor.com/api/dashboard/get-hard-limit', 
            {}, // empty JSON body
            {
                headers: {
                    Cookie: `WorkosCursorSessionToken=${token}`
                }
            }
        );
        return response.data;
    } catch (error: any) {
        log('[API] Error fetching usage limit: ' + error.message, true);
        throw error;
    }
}

export async function setUsageLimit(token: string, hardLimit: number, noUsageBasedAllowed: boolean): Promise<void> {
    try {
        await axios.post('https://www.cursor.com/api/dashboard/set-hard-limit', 
            {
                hardLimit,
                noUsageBasedAllowed
            },
            {
                headers: {
                    Cookie: `WorkosCursorSessionToken=${token}`
                }
            }
        );
        log(`[API] Successfully ${noUsageBasedAllowed ? 'disabled' : 'enabled'} usage-based pricing with limit: $${hardLimit}`);
    } catch (error: any) {
        log('[API] Error setting usage limit: ' + error.message, true);
        throw error;
    }
}

export async function checkUsageBasedStatus(token: string): Promise<{isEnabled: boolean, limit?: number}> {
    try {
        const response = await getCurrentUsageLimit(token);
        return {
            isEnabled: !response.noUsageBasedAllowed,
            limit: response.hardLimit
        };
    } catch (error: any) {
        log(`[API] Error checking usage-based status: ${error.message}`, true);
        return {
            isEnabled: false
        };
    }
}

async function fetchMonthData(token: string, month: number, year: number): Promise<UsageItem[]> {
    log(`[API] Fetching data for ${month}/${year}`);
    try {
        const response = await axios.post('https://www.cursor.com/api/dashboard/get-monthly-invoice', {
            month,
            year,
            includeUsageEvents: false
        }, {
            headers: {
                Cookie: `WorkosCursorSessionToken=${token}`
            }
        });
        log('[API] Monthly invoice response: ' + JSON.stringify({
            status: response.status,
            hasItems: !!response.data.items,
            itemCount: response.data.items?.length
        }));

        const usageItems: UsageItem[] = [];
        if (response.data.items) {
            for (const item of response.data.items) {
                log('[API] Processing invoice item: ' + JSON.stringify({
                    description: item.description,
                    cents: item.cents
                }));
                const requestCount = parseInt(item.description.match(/(\d+)/)[1]);
                const cents = item.cents;
                const costPerRequest = cents / requestCount;
                const dollars = cents / 100;

                usageItems.push({
                    calculation: `${requestCount}*${Math.floor(costPerRequest)}`,
                    totalDollars: `$${dollars.toFixed(2)}`
                });
            }
        }
        return usageItems;
    } catch (error: any) {
        const axiosError = error as ExtendedAxiosError;
        log(`[API] Error fetching monthly data for ${month}/${year}: ${axiosError.message}`, true);
        log('[API] API error details: ' + JSON.stringify({
            status: axiosError.response?.status,
            data: axiosError.response?.data,
            message: axiosError.message
        }), true);
        throw error;
    }
}

export async function fetchCursorStats(token: string): Promise<CursorStats> {
    log('[API] Fetching Cursor stats...');
    log('[API] Token format check: ' + JSON.stringify({
        containsSeparator: token.includes('%3A%3A'),
        length: token.length
    }));

    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();
    const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const lastYear = currentMonth === 1 ? currentYear - 1 : currentYear;

    log('[API] Date calculations: ' + JSON.stringify({
        currentMonth,
        currentYear,
        lastMonth,
        lastYear
    }));

    // Extract user ID from token
    const userId = token.split('%3A%3A')[0];
    log(`[API] Extracted userId for API calls: ${userId}`);

    log('[API] Fetching premium requests info...');
    try {
        const premiumResponse = await axios.get('https://www.cursor.com/api/usage', {
            params: { user: userId },
            headers: {
                Cookie: `WorkosCursorSessionToken=${token}`
            }
        });
        log('[API] Premium response: ' + JSON.stringify({
            status: premiumResponse.status,
            hasGPT4: !!premiumResponse.data['gpt-4'],
            numRequests: premiumResponse.data['gpt-4']?.numRequests,
            maxRequests: premiumResponse.data['gpt-4']?.maxRequestUsage
        }));

        return {
            currentMonth: {
                month: currentMonth,
                year: currentYear,
                usageBasedPricing: await fetchMonthData(token, currentMonth, currentYear)
            },
            lastMonth: {
                month: lastMonth,
                year: lastYear,
                usageBasedPricing: await fetchMonthData(token, lastMonth, lastYear)
            },
            premiumRequests: {
                current: premiumResponse.data['gpt-4'].numRequests,
                limit: premiumResponse.data['gpt-4'].maxRequestUsage
            }
        };
    } catch (error: any) {
        log('[API] Error fetching premium requests: ' + error, true);
        log('[API] API error details: ' + JSON.stringify({
            status: error.response?.status,
            data: error.response?.data,
            message: error.message
        }), true);
        throw error;
    }
} 