const siapakahAkuDb = {};

export function addUser(id, data) {
  siapakahAkuDb[id] = data;
}

export function removeUser(id) {
  delete siapakahAkuDb[id];
}

export function getUser(id) {
  return siapakahAkuDb[id];
}

export function isUserPlaying(id) {
  return !!siapakahAkuDb[id];
}