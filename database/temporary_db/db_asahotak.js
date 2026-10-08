const asahOtakDb = {};

export function addUser(id, data) {
  asahOtakDb[id] = data;
}

export function removeUser(id) {
  delete asahOtakDb[id];
}

export function getUser(id) {
  return asahOtakDb[id];
}

export function isUserPlaying(id) {
  return !!asahOtakDb[id];
}