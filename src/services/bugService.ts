import config, { NODE_ENV } from '../config';
import { Storage } from '@google-cloud/storage';
import { Logger } from 'winston';

interface UploadOption {
  skipTimestamp?: boolean;
}

const storage = new Storage();

async function uploadImageToGCP(
  fileName: string,
  buffer: Buffer,
  logger: Logger
): Promise<void> {
  try {
    const bucket = storage.bucket(config.miscStorageBucket ?? '');
    const file = bucket.file(fileName);
    await file.save(buffer);
  } catch (error) {
    logger.error('Error uploading buffer:', error);
  }
}

// TODO Save to local volume for development
export const uploadDebugImage = async (
  buffer: Buffer,
  fileName: string,
  userId: string,
  logger: Logger,
  botId?: string,
  opts?: UploadOption
) => {
  try {
    // Check if debug image upload is disabled via environment variable
    if (process.env.ENABLE_DEBUG_IMAGE_UPLOAD === 'false') {
      logger.info('Debug image upload is disabled via ENABLE_DEBUG_IMAGE_UPLOAD');
      return;
    }

    if (NODE_ENV === 'development') {
      // TODO add disk based file saving
      return;
    }

    // Check if GCP credentials are configured
    if (!config.miscStorageBucket || !config.region) {
      logger.info('GCP credentials not configured, skipping debug image upload');
      return;
    }

    logger.info('Begin upload Debug Image', userId);
    const bot = botId ?? 'bot';
    const now = opts?.skipTimestamp ? '' : `-${new Date().toISOString()}`;
    const qualifiedFile = `${config.miscStorageFolder}/${userId}/${bot}/${fileName}${now}.png`;
    await uploadImageToGCP(qualifiedFile, buffer, logger);
    logger.info(`Debug Image File uploaded successfully: ${fileName}`, userId);
  } catch (err) {
    logger.error('Error uploading debug image:', userId, err);
  }
};
