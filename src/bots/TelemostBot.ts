import { JoinParams } from './AbstractMeetBot';
import { BotStatus, WaitPromise } from '../types';
import config from '../config';
import { WaitingAtLobbyRetryError } from '../error';
import { v4 } from 'uuid';
import { patchBotStatus } from '../services/botService';
import { ContextBridgeTask } from '../tasks/ContextBridgeTask';
import { getWaitingPromise } from '../lib/promise';
import createBrowserContext from '../lib/chromium';
import { uploadDebugImage } from '../services/bugService';
import { Logger } from 'winston';
import { Page } from 'playwright';
import { browserLogCaptureCallback } from '../util/logger';
import { handleWaitingAtLobbyError, MeetBotBase } from './MeetBotBase';
import { TELEMOST_REQUEST_DENIED } from '../constants';
import { vp9MimeType, webmMimeType } from '../lib/recording';

export class TelemostBot extends MeetBotBase {
  protected page: Page;
  protected slightlySecretId: string; // Use any hard-to-guess identifier
  protected _logger: Logger;
  protected _correlationId: string;
  
  constructor(logger: Logger, correlationId: string) {
    super();
    this.slightlySecretId = v4();
    this._logger = logger;
    this._correlationId = correlationId;
  }

  async join({ url, name, bearerToken, teamId, timezone, userId, eventId, botId, uploader }: JoinParams): Promise<void> {
    const _state: BotStatus[] = ['processing'];

    const handleUpload = async () => {
      this._logger.info('Begin recording upload to server', { userId, teamId });
      const uploadResult = await uploader.uploadRecordingToRemoteStorage();
      this._logger.info('Recording upload result', { uploadResult, userId, teamId });
      return uploadResult;
    };
    
    try {
      const pushState = (st: BotStatus) => _state.push(st);
      await this.joinMeeting({ url, name, bearerToken, teamId, timezone, userId, eventId, botId, pushState, uploader });
      await patchBotStatus({ botId, eventId, provider: 'telemost', status: _state, token: bearerToken }, this._logger);

      // Finish upload from temp video
      const uploadResult = await handleUpload();

      if (_state.includes('finished') && !uploadResult) {
        _state.splice(_state.indexOf('finished'), 1, 'failed');
        this._logger.error('Recording completed but upload failed', { botId, userId, teamId });
        await patchBotStatus({ botId, eventId, provider: 'telemost', status: _state, token: bearerToken }, this._logger);
        throw new Error('Recording upload failed');
      } else if (uploadResult) {
        this._logger.info('Upload completed successfully', { botId, userId, teamId });
      }
    } catch(error) {
      if (!_state.includes('finished')) 
        _state.push('failed');

      await patchBotStatus({ botId, eventId, provider: 'telemost', status: _state, token: bearerToken }, this._logger);
      
      if (error instanceof WaitingAtLobbyRetryError) {
        await handleWaitingAtLobbyError({ token: bearerToken, botId, eventId, provider: 'telemost', error }, this._logger);
      }

      throw error;
    }
  }

  private async joinMeeting({ pushState, ...params }: JoinParams & { pushState(state: BotStatus): void }): Promise<void> {
    const { url, name } = params;
    this._logger.info('Launching browser for Telemost...', { userId: params.userId });

    this.page = await createBrowserContext(url, this._correlationId, 'telemost');

    await this.page.waitForTimeout(1000);

    this._logger.info('Navigating to Telemost Meeting URL...');
    await this.page.goto(url, { waitUntil: 'networkidle' });

    // Wait for page to load
    this._logger.info('Waiting for 10 seconds...');
    await this.page.waitForTimeout(10000);

    // Handle cookie consent if present
    try {
      this._logger.info('Looking for cookie consent button...');
      const cookieButton = await this.page.locator('button', { hasText: /Принять|Accept/i }).first();
      if (await cookieButton.isVisible({ timeout: 5000 })) {
        this._logger.info('Clicking cookie consent button...');
        await cookieButton.click();
        await this.page.waitForTimeout(2000);
      }
    } catch (error) {
      this._logger.info('Cookie consent button not found or not needed', error);
    }

    // Try to find and click "Join as guest" button
    this._logger.info('Looking for "Join as guest" button...');
    try {
      const guestButtonSelectors = [
        'button:has-text("Войти как гость")',
        'button:has-text("Join as guest")',
        'button:has-text("Войти анонимно")',
        'button:has-text("Join anonymously")',
        'button[data-testid="guest-join-button"]',
        'a[href*="guest"]',
      ];

      let buttonClicked = false;
      for (const selector of guestButtonSelectors) {
        try {
          const button = await this.page.locator(selector).first();
          if (await button.isVisible({ timeout: 5000 })) {
            this._logger.info(`Found guest button with selector: ${selector}`);
            await button.click({ timeout: 5000 });
            buttonClicked = true;
            this._logger.info('Successfully clicked guest join button');
            await this.page.waitForTimeout(3000);
            break;
          }
        } catch (err) {
          this._logger.info(`Selector not found: ${selector}`);
          continue;
        }
      }

      if (!buttonClicked) {
        this._logger.info('Guest join button not found, proceeding anyway...');
      }
    } catch (error) {
      this._logger.info('Error finding guest join button', error);
    }

    // Wait for name input field
    this._logger.info('Waiting for name input field...');
    try {
      const nameInputSelectors = [
        'input[data-testid="orb-textinput-input"]', // Самый надежный селектор
        '[data-testid="orb-textinput"] input[type="text"]', // Через родительский элемент
        'input.Orb-Textinput-input', // По классу
        'input[type="text"][class*="Orb-Textinput"]', // Комбинация
        'input[type="text"]', // Fallback
      ];

      let inputFound = false;
      let foundSelector = '';
      
      for (const selector of nameInputSelectors) {
        try {
          const input = await this.page.locator(selector).first();
          if (await input.isVisible({ timeout: 10000 })) {
            this._logger.info(`Found name input field with selector: ${selector}`);
            foundSelector = selector;
            inputFound = true;
            break;
          }
        } catch (err) {
          this._logger.debug(`Name input selector not found: ${selector}`);
          continue;
        }
      }

      if (!inputFound) {
        this._logger.error('Could not find name input field with any selector');
        await uploadDebugImage(await this.page.screenshot({ type: 'png', fullPage: true }), 'name-input-field', params.userId, this._logger, params.botId);
        throw new Error('Could not find name input field on Telemost page');
      }

      // Clear existing value and fill in the name
      this._logger.info(`Filling name input field with selector: ${foundSelector}`);
      await this.page.fill(foundSelector, ''); // Clear "Гость" value
      await this.page.fill(foundSelector, name ? name : 'ScreenApp Notetaker');
      await this.page.waitForTimeout(1000);
      
      // Verify the value was set
      const inputValue = await this.page.inputValue(foundSelector);
      this._logger.info(`Name input field value set to: ${inputValue}`);
    } catch (error) {
      this._logger.error('Error finding or filling name input field', error);
      await uploadDebugImage(await this.page.screenshot({ type: 'png', fullPage: true }), 'name-input-field-error', params.userId, this._logger, params.botId);
      throw error;
    }

    // Handle device permissions
    this._logger.info('Handling device permissions...');
    try {
      // Look for camera/microphone permission dialogs
      const allowButtonSelectors = [
        'button:has-text("Разрешить")',
        'button:has-text("Allow")',
        'button:has-text("Продолжить")',
        'button:has-text("Continue")',
        '[data-testid="allow-button"]',
      ];

      for (const selector of allowButtonSelectors) {
        try {
          const button = await this.page.locator(selector).first();
          if (await button.isVisible({ timeout: 3000 })) {
            this._logger.info(`Found permission button with selector: ${selector}`);
            await button.click({ timeout: 3000 });
            await this.page.waitForTimeout(1000);
          }
        } catch (err) {
          // Continue trying other selectors
        }
      }
    } catch (error) {
      this._logger.info('Error handling device permissions', error);
    }

    // Click join button
    this._logger.info('Looking for join button...');
    try {
      const joinButtonSelectors = [
        'button[data-test-id="enter-conference-button"]', // Самый надежный
        'button.joinMeetingButton_M38VH', // По классу
        'button:has-text("Подключиться")', // По тексту
        'button:has-text("Join")', // Английский вариант
        'button[class*="joinMeetingButton"]', // Частичное совпадение класса
        'button:has-text("Присоединиться")', // Альтернативный текст
        'button:has-text("Войти")', // Еще один вариант
      ];

      let buttonClicked = false;
      for (const selector of joinButtonSelectors) {
        try {
          const button = await this.page.locator(selector).first();
          if (await button.isVisible({ timeout: 5000 })) {
            this._logger.info(`Found join button with selector: ${selector}`);
            await button.click({ timeout: 5000 });
            buttonClicked = true;
            this._logger.info('Successfully clicked join button');
            await this.page.waitForTimeout(2000);
            break;
          }
        } catch (err) {
          this._logger.debug(`Join button selector not found: ${selector}`);
          continue;
        }
      }

      if (!buttonClicked) {
        throw new Error('Could not find any join button variant');
      }
    } catch (error) {
      this._logger.error('Error clicking join button', error);
      await uploadDebugImage(await this.page.screenshot({ type: 'png', fullPage: true }), 'join-button-click', params.userId, this._logger, params.botId);
      throw new Error('Failed to click join button');
    }

    // Wait in lobby if needed
    try {
      const wanderingTime = config.joinWaitTime * 60 * 1000; // Give some time to be let in

      let waitTimeout: NodeJS.Timeout;
      let waitInterval: NodeJS.Timeout;
      const waitAtLobbyPromise = new Promise<boolean>((resolveMe) => {
        waitTimeout = setTimeout(() => {
          clearInterval(waitInterval);
          resolveMe(false);
        }, wanderingTime);

        waitInterval = setInterval(async () => {
          try {
            // Check if we're still in lobby or have been admitted
            const currentUrl = this.page.url();
            
            // If URL changed from the lobby pattern, we're likely in the meeting
            if (!currentUrl.includes('lobby') && !currentUrl.includes('waiting')) {
              this._logger.info('Telemost Bot is entering the meeting...');
              clearInterval(waitInterval);
              clearTimeout(waitTimeout);
              resolveMe(true);
              return;
            }

            // Check for meeting UI elements that indicate we're in
            const meetingElements = await this.page.locator('div[role="main"], video, [data-testid="meeting-container"]').first();
            if (await meetingElements.isVisible({ timeout: 2000 })) {
              this._logger.info('Telemost Bot is entering the meeting...');
              clearInterval(waitInterval);
              clearTimeout(waitTimeout);
              resolveMe(true);
              return;
            }

            // Check for denied access message
            const bodyText = await this.page.evaluate(() => document.body.innerText);
            if (bodyText && (bodyText.includes('Доступ запрещен') || bodyText.includes('Access denied') || bodyText.includes(TELEMOST_REQUEST_DENIED))) {
              this._logger.info('Telemost Bot is denied access to the meeting...');
              clearInterval(waitInterval);
              clearTimeout(waitTimeout);
              resolveMe(false);
              return;
            }
          } catch(e) {
            // Do nothing
          }
        }, 5000);
      });

      const joined = await waitAtLobbyPromise;
      if (!joined) {
        const bodyText = await this.page.evaluate(() => document.body.innerText);

        const userDenied = (bodyText || '')?.includes(TELEMOST_REQUEST_DENIED);

        this._logger.error('Cant finish wait at lobby check', { userDenied, waitingAtLobbySuccess: joined, bodyText });

        // Don't retry lobby errors - if user doesn't admit bot, retrying won't help
        throw new WaitingAtLobbyRetryError('Telemost bot could not enter meeting...', bodyText ?? '', false, 0);
      }

      this._logger.info('Bot is entering meeting after wait room...');
    } catch (error) {
      this._logger.info('Closing the browser on error...', error);
      await this.page.context().browser()?.close();

      throw error;
    }

    pushState('joined');

    // Handle any post-join dialogs
    try {
      this._logger.info('Handling post-join dialogs...');
      
      // Look for and dismiss any modal dialogs
      const dismissDialogs = async () => {
        try {
          const closeButtonSelectors = [
            'button[aria-label="Закрыть"]',
            'button[aria-label="Close"]',
            'button:has-text("Закрыть")',
            'button:has-text("Close")',
            'button:has-text("ОК")',
            'button:has-text("OK")',
            '[data-testid="close-button"]',
          ];

          for (const selector of closeButtonSelectors) {
            try {
              const buttons = await this.page.locator(selector).all();
              for (const button of buttons) {
                if (await button.isVisible({ timeout: 2000 })) {
                  await button.click({ timeout: 2000 });
                  this._logger.info(`Dismissed dialog with selector: ${selector}`);
                  await this.page.waitForTimeout(1000);
                }
              }
            } catch (err) {
              // Continue trying other selectors
            }
          }
        } catch (error) {
          this._logger.info('Error dismissing dialogs', error);
        }
      };

      // Try to dismiss dialogs multiple times
      await dismissDialogs();
      await this.page.waitForTimeout(3000);
      await dismissDialogs();
    } catch (error) {
      this._logger.info('Error handling post-join dialogs', error);
    }

    // Recording meeting page
    this._logger.info('Begin recording...');
    await this.recordMeetingPage({ ...params });
    
    pushState('finished');
  }

  private async recordMeetingPage(params: JoinParams): Promise<void> {
    const { teamId, userId, eventId, botId, uploader } = params;
    const duration = config.maxRecordingDuration * 60 * 1000;
    const inactivityLimit = config.inactivityLimit * 60 * 1000;

    // Capture and send the browser console logs to Node.js context
    this.page?.on('console', async msg => {
      try {
        await browserLogCaptureCallback(this._logger, msg);
      } catch(err) {
        this._logger.info('Playwright chrome logger: Failed to log browser messages...', err?.message);
      }
    });

    await this.page.exposeFunction('screenAppSendData', async (slightlySecretId: string, data: string) => {
      if (slightlySecretId !== this.slightlySecretId) return;

      const buffer = Buffer.from(data, 'base64');
      await uploader.saveDataToTempFile(buffer);
    });

    await this.page.exposeFunction('screenAppMeetEnd', (slightlySecretId: string) => {
      if (slightlySecretId !== this.slightlySecretId) return;
      try {
        this._logger.info('Attempt to end meeting early...');
        waitingPromise.resolveEarly();
      } catch (error) {
        console.error('Could not process meeting end event', error);
      }
    });

    // Inject the MediaRecorder code into the browser context using page.evaluate
    await this.page.evaluate(
      async ({ teamId, duration, inactivityLimit, userId, slightlySecretId, activateInactivityDetectionAfter, activateInactivityDetectionAfterMinutes, primaryMimeType, secondaryMimeType }: 
      { teamId:string, userId: string, duration: number, inactivityLimit: number, slightlySecretId: string, activateInactivityDetectionAfter: string, activateInactivityDetectionAfterMinutes: number, primaryMimeType: string, secondaryMimeType: string }) => {
        let timeoutId: NodeJS.Timeout;
        let inactivityParticipantDetectionTimeout: NodeJS.Timeout;
        let inactivitySilenceDetectionTimeout: NodeJS.Timeout;
        let isOnValidTelemostPageInterval: NodeJS.Timeout;

        const sendChunkToServer = async (chunk: ArrayBuffer) => {
          function arrayBufferToBase64(buffer: ArrayBuffer) {
            let binary = '';
            const bytes = new Uint8Array(buffer);
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            return btoa(binary);
          }
          const base64 = arrayBufferToBase64(chunk);
          await (window as any).screenAppSendData(slightlySecretId, base64);
        };

        async function startRecording() {
          console.log('Will activate the inactivity detection after', activateInactivityDetectionAfter);

          // Check for the availability of the mediaDevices API
          if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            console.error('MediaDevices or getDisplayMedia not supported in this browser.');
            return;
          }
          
          const stream: MediaStream = await (navigator.mediaDevices as any).getDisplayMedia({
            video: true,
            audio: {
              autoGainControl: false,
              channels: 2,
              channelCount: 2,
              echoCancellation: false,
              noiseSuppression: false,
            },
            preferCurrentTab: true,
          });

          // Check if we actually got audio tracks
          const audioTracks = stream.getAudioTracks();
          const hasAudioTracks = audioTracks.length > 0;
          
          if (!hasAudioTracks) {
            console.warn('No audio tracks available for silence detection. Will rely only on presence detection.');
          }

          let options: MediaRecorderOptions = {};
          if (MediaRecorder.isTypeSupported(primaryMimeType)) {
            console.log(`Media Recorder will use ${primaryMimeType} codecs...`);
            options = { mimeType: primaryMimeType };
          }
          else {
            console.warn(`Media Recorder did not find primary mime type codecs ${primaryMimeType}, Using fallback codecs ${secondaryMimeType}`);
            options = { mimeType: secondaryMimeType };
          }

          const mediaRecorder = new MediaRecorder(stream, { ...options });

          mediaRecorder.ondataavailable = async (event: BlobEvent) => {
            if (!event.data.size) {
              console.warn('Received empty chunk...');
              return;
            }
            try {
              const arrayBuffer = await event.data.arrayBuffer();
              sendChunkToServer(arrayBuffer);
            } catch (error) {
              console.error('Error uploading chunk:', error);
            }
          };

          // Start recording with 2-second intervals
          const chunkDuration = 2000;
          mediaRecorder.start(chunkDuration);

          let dismissModalsInterval: NodeJS.Timeout;
          let lastDimissError: Error | null = null;

          const stopTheRecording = async () => {
            mediaRecorder.stop();
            stream.getTracks().forEach((track) => track.stop());

            // Cleanup recording timer
            clearTimeout(timeoutId);

            // Cancel the perpetual checks
            if (inactivityParticipantDetectionTimeout) {
              clearTimeout(inactivityParticipantDetectionTimeout);
            }
            if (inactivitySilenceDetectionTimeout) {
              clearTimeout(inactivitySilenceDetectionTimeout);
            }
            if (isOnValidTelemostPageInterval) {
              clearInterval(isOnValidTelemostPageInterval);
            }

            if (dismissModalsInterval) {
              clearInterval(dismissModalsInterval);
              if (lastDimissError && lastDimissError instanceof Error) {
                console.error('Error dismissing modals:', { lastDimissError, message: lastDimissError?.message });
              }
            }

            // Begin browser cleanup
            (window as any).screenAppMeetEnd(slightlySecretId);
          };

          /**
           * Perpetual checks for inactivity detection
           */
          inactivityParticipantDetectionTimeout = setTimeout(() => {
            detectLoneParticipantResilient();
          }, activateInactivityDetectionAfterMinutes * 60 * 1000);

          const detectIncrediblySilentMeeting = () => {
            // Only run silence detection if we have audio tracks
            if (!hasAudioTracks) {
              console.warn('Skipping silence detection - no audio tracks available. This may be due to browser permissions or Telemost audio sharing settings.');
              console.warn('Meeting will rely on presence detection and max duration timeout.');
              return;
            }

            try {
              const audioContext = new AudioContext();
              const mediaSource = audioContext.createMediaStreamSource(stream);
              const analyser = audioContext.createAnalyser();

              /* Use a value suitable for the given use case of silence detection
                 |
                 |____ Relatively smaller FFT size for faster processing and less sampling
              */
              analyser.fftSize = 256;

              mediaSource.connect(analyser);

              const dataArray = new Uint8Array(analyser.frequencyBinCount);
              
              // Sliding silence period
              let silenceDuration = 0;
              let totalChecks = 0;
              let audioActivitySum = 0;

              // Audio gain/volume
              const silenceThreshold = 10;

              let monitor = true;

              const monitorSilence = () => {
                try {
                  analyser.getByteFrequencyData(dataArray);

                  const audioActivity = dataArray.reduce((a, b) => a + b) / dataArray.length;
                  audioActivitySum += audioActivity;
                  totalChecks++;

                  if (audioActivity < silenceThreshold) {
                    silenceDuration += 100; // Check every 100ms
                    if (silenceDuration >= inactivityLimit) {
                        console.warn('Detected silence in Telemost and ending the recording on team:', userId, teamId);
                        console.log('Silence detection stats - Avg audio activity:', (audioActivitySum / totalChecks).toFixed(2), 'Checks performed:', totalChecks);
                        monitor = false;
                        stopTheRecording();
                    }
                  } else {
                    silenceDuration = 0;
                  }

                  if (monitor) {
                    // Recursively queue the next check
                    setTimeout(monitorSilence, 100);
                  }
                } catch (error) {
                  console.error('Error in silence monitoring:', error);
                  console.warn('Silence detection failed - will rely on presence detection and max duration timeout.');
                  // Stop monitoring on error
                  monitor = false;
                }
              };

              // Go silence monitor
              monitorSilence();
            } catch (error) {
              console.error('Failed to initialize silence detection:', error);
              console.warn('Will rely on presence detection and max duration timeout.');
            }
          };

          /**
           * Perpetual checks for inactivity detection
           */
          inactivitySilenceDetectionTimeout = setTimeout(() => {
            detectIncrediblySilentMeeting();
          }, activateInactivityDetectionAfterMinutes * 60 * 1000);

          function detectLoneParticipantResilient(): void {
            const re = /^[0-9]+$/;
          
            function findPeopleButton() {
                try {
                  // Try to locate using attribute "starts with"
                  let btn: Element | null | undefined = document.querySelector('button[aria-label^="People"]');
                  if (btn) return btn;
                
                  // Try to locate using attribute "contains"
                  btn = document.querySelector('button[aria-label*="People"]');
                  if (btn) return btn;
                
                  // Try via regex on aria-label (for more complex patterns)
                  const allBtns = Array.from(document.querySelectorAll('button[aria-label]'));
                  btn = allBtns.find(b => {
                    const label = b.getAttribute('aria-label');
                    return label && /^People - \d+ joined$/.test(label);
                  });
                  if (btn) return btn;
                
                  // Fallback: Look for button with a child icon containing "people"
                  btn = allBtns.find(b =>
                    Array.from(b.querySelectorAll('i')).some(i =>
                      i.textContent && i.textContent.trim() === 'people'
                    )
                  );
                  if (btn) return btn;
                
                  // Not found
                  return null;
                } catch (error) {
                  console.error('Error finding people button:', error);
                  return null;
                }
              }

            function getContributorsCount(): number | undefined {

              // 1. Try main DOM with aria-label first
              try {
                const peopleBtn = findPeopleButton();
                if (peopleBtn) {
                  const divs = Array.from((peopleBtn.parentNode as HTMLElement)?.parentNode?.querySelectorAll('div') ?? []);
                  for (const node of divs) {
                    if (typeof (node as HTMLElement).innerText === 'string' && re.test((node as HTMLElement).innerText.trim())) {
                      return Number((node as HTMLElement).innerText.trim());
                    }
                  }
                }
              } catch {
                console.log('1 Error getting contributors count:', { root: document.body.innerText });
              }
          
              return undefined;
            }
          
            function retryWithBackoff(): void {
              const loneTest = setTimeout(function check() {
                if (!loneTestDetectionActive) {
                  if (loneTest) {
                    clearTimeout(loneTest);
                  }
                  return;
                }
                let contributors: number | undefined;
                try {
                  contributors = getContributorsCount();
                  if (typeof contributors === 'undefined') {
                    detectionFailures++;
                    console.warn('Telemost participant detection failed, retrying. Failure count:', detectionFailures);
                    // Log for debugging
                    if (detectionFailures >= maxDetectionFailures) {
                      console.log('Persistent detection failures:', { bodyText: `${document.body.innerText?.toString()}` });
                      loneTestDetectionActive = false;
                      return;
                    }
                    retryWithBackoff();
                    return;
                  }
                  detectionFailures = 0;
                  if (contributors < 2) {
                    console.log('Bot is alone, ending meeting.');
                    loneTestDetectionActive = false;
                    stopTheRecording();
                    return;
                  }
                } catch (err) {
                  detectionFailures++;
                  console.error('Detection error:', err);
                  retryWithBackoff();
                }
              }, 5000);
            }
          
            let loneTestDetectionActive = true;
            let detectionFailures = 0;
            const maxDetectionFailures = 10; // Track up to 10 consecutive failures
            retryWithBackoff();
          }

          const detectMeetingIsOnAValidPage = () => {
            // Simple check to verify we're still on a supported Telemost page
            const isOnValidTelemostPage = () => {
              try {
                // Check if we're still on a Telemost URL
                const currentUrl = window.location.href;
                if (!currentUrl.includes('telemost.yandex.ru')) {
                  console.warn('No longer on Telemost page - URL changed to:', currentUrl);
                  return false;
                }

                const currentBodyText = document.body.innerText;
                if (currentBodyText.includes('You\'ve been removed from the meeting') || 
                    currentBodyText.includes('Доступ запрещен') ||
                    currentBodyText.includes('Connection lost')) {
                  console.warn('Bot was removed from the meeting - ending recording on team:', userId, teamId);
                  return false;
                }

                // Check for basic Telemost UI elements
                const hasTelemostElements = document.querySelector('video') !== null ||
                                             document.querySelector('[data-testid="meeting-container"]') !== null ||
                                             document.querySelector('button[aria-label="Leave call"]') !== null;

                if (!hasTelemostElements) {
                  console.warn('Telemost UI elements not found - page may have changed state');
                  return false;
                }

                return true;
              } catch (error) {
                console.error('Error checking page validity:', error);
                return false;
              }
            };

            // check if we're still on a valid Telemost page
            isOnValidTelemostPageInterval = setInterval(() => {
              if (!isOnValidTelemostPage()) {
                console.log('Telemost page state changed - ending recording on team:', userId, teamId);
                clearInterval(isOnValidTelemostPageInterval);
                stopTheRecording();
              }
            }, 10000);
          };

          // Initialize page validity detection
          detectMeetingIsOnAValidPage();

          /**
           * Perpetual checks for inactivity detection
           */
          inactivityParticipantDetectionTimeout = setTimeout(() => {
            detectLoneParticipantResilient();
          }, activateInactivityDetectionAfterMinutes * 60 * 1000);

          inactivitySilenceDetectionTimeout = setTimeout(() => {
            detectIncrediblySilentMeeting();
          }, activateInactivityDetectionAfterMinutes * 60 * 1000);

          const detectModalsAndDismiss = () => {
            let dismissModalErrorCount = 0;
            const maxDismissModalErrorCount = 10;
            dismissModalsInterval = setInterval(() => {
              try {
                const buttons = document.querySelectorAll('button, [role="button"]');
                const dismissButtons = Array.from(buttons).filter((button) => {
                  const text = button?.textContent || button?.getAttribute('aria-label');
                  return text && (text.includes('OK') || text.includes('ОК') || text.includes('Закрыть') || text.includes('Close'));
                });
                
                if (dismissButtons.length > 0) {
                  console.log('Found dismiss buttons:', dismissButtons.length);
                  for (const button of dismissButtons) {
                    try {
                      if (button && (button as HTMLElement).offsetParent !== null) {
                        (button as HTMLElement).click();
                        console.log('Clicked dismiss button');
                      }
                    } catch (err) {
                      lastDimissError = err;
                      dismissModalErrorCount++;
                      if (dismissModalErrorCount >= maxDismissModalErrorCount) {
                        console.error(`Failed to dismiss modals ${maxDismissModalErrorCount} times, will stop trying...`);
                        clearInterval(dismissModalsInterval);
                      }
                    }
                  }
                }
              } catch(error) {
                lastDimissError = error;
                dismissModalErrorCount++;
                if (dismissModalErrorCount >= maxDismissModalErrorCount) {
                  console.error(`Error dismissing modals: ${error}, will stop trying...`);
                  clearInterval(dismissModalsInterval);
                }
              }
            }, 2000);
          };

          detectModalsAndDismiss();

          // Cancel this timeout when stopping recording
          timeoutId = setTimeout(async () => {
            stopTheRecording();
          }, duration);
        }

        // Start the recording
        await startRecording();
      },
      { 
        teamId,
        duration,
        inactivityLimit,
        userId,
        slightlySecretId: this.slightlySecretId,
        activateInactivityDetectionAfter: new Date(new Date().getTime() + config.activateInactivityDetectionAfter * 60 * 1000).toISOString(),
        activateInactivityDetectionAfterMinutes: config.activateInactivityDetectionAfter,
        primaryMimeType: webmMimeType,
        secondaryMimeType: vp9MimeType
      }
    );
  
    this._logger.info('Waiting for recording duration', config.maxRecordingDuration, 'minutes...');
    const processingTime = 0.2 * 60 * 1000;
    const waitingPromise: WaitPromise = getWaitingPromise(processingTime + duration);

    waitingPromise.promise.then(async () => {
      this._logger.info('Closing the browser...');
      await this.page.context().browser()?.close();

      this._logger.info('All done ✨', { eventId, botId, userId, teamId });
    });

    await waitingPromise.promise;
  }
}
