function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatDurationUz(totalSeconds) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;

  if (!minutes) {
    return `${restSeconds} soniya`;
  }

  if (!restSeconds) {
    return `${minutes} daqiqa`;
  }

  return `${minutes} daqiqa ${restSeconds} soniya`;
}

module.exports = {
  formatDurationUz,
  sleep,
};
