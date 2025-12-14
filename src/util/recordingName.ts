export const getRecordingNamePrefix = (provider: 'google' | 'microsoft' | 'zoom' | 'telemost') => {
  switch(provider) {
    case 'google':
      return 'Google Meet Recording';
    case 'microsoft':
      return 'Microsoft Teams Recording';
    case 'zoom':
      return 'Zoom Recording';
    case 'telemost':
      return 'Yandex Telemost Recording';
    default:
      return 'Recording';
  }
};
