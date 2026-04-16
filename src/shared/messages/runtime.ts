export const RUNTIME_MESSAGE_ACTIONS = {
  keepAlive: 'keepAlive',
  forceRefresh: 'forceRefresh',
} as const;

export const KEEP_ALIVE_ACTION = RUNTIME_MESSAGE_ACTIONS.keepAlive;
export const FORCE_REFRESH_ACTION = RUNTIME_MESSAGE_ACTIONS.forceRefresh;

export type RuntimeMessageAction =
  (typeof RUNTIME_MESSAGE_ACTIONS)[keyof typeof RUNTIME_MESSAGE_ACTIONS];

export type RuntimeMessage =
  | {
      action: typeof RUNTIME_MESSAGE_ACTIONS.keepAlive;
    }
  | {
      action: typeof RUNTIME_MESSAGE_ACTIONS.forceRefresh;
    };

export type RuntimeMessageResponse =
  | {
      status: 'acknowledged';
      timestamp: number;
    }
  | {
      status: 'refreshed';
    }
  | {
      status: 'ignored';
    };
