import { createApiV2 } from '../util/auth';
import { BotStatus, IVFSResponse, LogCategory, LogSubCategory } from '../types';
import config from '../config';
import { Logger } from 'winston';

export const patchBotStatus = async ({
  eventId,
  botId,
  provider,
  status,
  token,
}: {
    eventId?: string,
    token: string,
    botId?: string,
    provider: 'google' | 'microsoft' | 'zoom' | 'telemost',
    status: BotStatus[],
}, logger: Logger) => {
  try {
    const apiV2 = createApiV2(token, config.serviceKey);
    const response = await apiV2.patch<
        IVFSResponse<never>
    >('/meeting/app/bot/status', {
      eventId,
      botId,
      provider,
      status,
    });
    return response.data.success;
  } catch(e: any) {
    // Если сервис недоступен - это не критичная ошибка
    if (e?.code === 'ECONNREFUSED' || e?.message?.includes('ECONNREFUSED') || e?.message?.includes('connect')) {
      logger.warn('Auth service unavailable, skipping status update', {
        error: e?.message,
        requestData: { eventId, botId, provider, status }
      });
      return false; // Не критичная ошибка, не прерываем работу
    }
    
    // Для других ошибок логируем как обычно
    logger.error('Can\'t update the bot status', {
      error: e?.message || String(e),
      status: e?.response?.status,
      statusText: e?.response?.statusText,
      responseData: e?.response?.data,
      requestData: { eventId, botId, provider, status },
      stack: e?.stack
    });
    return false;
  }
};

export const addBotLog = async ({
  eventId,
  botId,
  provider,
  level,
  message,
  category,
  subCategory,
  token,
}: {
    eventId?: string,
    token: string,
    botId?: string,
    provider: 'google' | 'microsoft' | 'zoom' | 'telemost',
    level: 'info' | 'error',
    message: string,
    category: LogCategory,
    subCategory: LogSubCategory<LogCategory>,
}, logger: Logger) => {
  try {
    const apiV2 = createApiV2(token, config.serviceKey);
    const response = await apiV2.patch<
        IVFSResponse<never>
    >('/meeting/app/bot/log', {
      eventId,
      botId,
      provider,
      level,
      message,
      category,
      subCategory,
    });
    return response.data.success;
  } catch(e: any) {
    // Если сервис недоступен - это не критичная ошибка
    if (e?.code === 'ECONNREFUSED' || e?.message?.includes('ECONNREFUSED') || e?.message?.includes('connect')) {
      logger.warn('Auth service unavailable, skipping bot log', {
        error: e?.message,
        requestData: { eventId, botId, provider, level, message, category, subCategory }
      });
      return false; // Не критичная ошибка, не прерываем работу
    }
    
    // Для других ошибок логируем как обычно
    logger.error('Can\'t add the bot log', {
      error: e?.message || String(e),
      status: e?.response?.status,
      statusText: e?.response?.statusText,
      responseData: e?.response?.data,
      requestData: { eventId, botId, provider, level, message, category, subCategory },
      stack: e?.stack
    });
    return false;
  }
};
