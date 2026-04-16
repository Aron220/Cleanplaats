import { API_RULE_ID, API_URL_PATTERNS } from '@/shared/constants/domains';

const browserApi = browser;
type DynamicRule = {
  id: number;
  priority: number;
  action: {
    type: 'redirect';
    redirect: {
      transform: {
        queryTransform: {
          removeParams: string[];
          addOrReplaceParams: Array<{ key: string; value: string }>;
        };
      };
    };
  };
  condition: {
    urlFilter: string;
    resourceTypes: Array<'xmlhttprequest'>;
  };
};

export function shouldModifyApiRules(resultsPerPage: string): boolean {
  return resultsPerPage !== '30';
}

function buildUrlFilter(patterns: readonly string[]): string {
  return patterns.map((pattern) => pattern.replace('*', '')).join('|');
}

export function buildDynamicRules(resultsPerPage: string): DynamicRule[] {
  if (!shouldModifyApiRules(resultsPerPage)) {
    return [];
  }

  const rule: DynamicRule = {
    id: API_RULE_ID,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: {
        transform: {
          queryTransform: {
            removeParams: [],
            addOrReplaceParams: [],
          },
        },
      },
    },
    condition: {
      urlFilter: buildUrlFilter(API_URL_PATTERNS),
      resourceTypes: ['xmlhttprequest'],
    },
  };

  rule.action.redirect.transform.queryTransform.addOrReplaceParams.push({
    key: 'limit',
    value: resultsPerPage,
  });

  return [rule];
}

export async function updateApiRequestRules(resultsPerPage: string): Promise<void> {
  const removeRuleIds = [API_RULE_ID];
  const addRules = buildDynamicRules(resultsPerPage);

  try {
    await browserApi.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules,
    } as never);
    console.info('Cleanplaats: Dynamic API rules updated', {
      resultsPerPage,
      ruleCount: addRules.length,
    });
  } catch (error) {
    console.error('Cleanplaats: Failed to update dynamic API rules', {
      resultsPerPage,
      error,
    });
  }
}

export async function clearAllDynamicRules(): Promise<void> {
  const existingRules = await browserApi.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existingRules.map((rule: { id: number }) => rule.id);

  if (!removeRuleIds.length) {
    return;
  }

  await browserApi.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
  } as never);
}
