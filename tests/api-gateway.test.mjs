// lib/api-gateway.js — isPrivateAddress: penjaga SSRF untuk /api/v1/image.
// Server mengunduh gambar dari URL yang dikirim pemilik token; alamat di
// jaringan internal (localhost, metadata cloud, LAN) tidak boleh dijangkau.
import test from "node:test";
import assert from "node:assert/strict";
import { pindahKeFolderSementara } from "./_helpers.mjs";

// Modul ini (lewat lib/monitor.js) membaca/menulis <cwd>/database/runtime.
pindahKeFolderSementara("gateway");
const { isPrivateAddress } = await import("../lib/api-gateway.js");

test("IPv4 internal ditolak", () => {
  for (const ip of [
    "0.0.0.0", "10.0.0.1", "10.255.255.255", "100.64.0.1", "127.0.0.1", "127.8.9.10",
    "169.254.169.254", // metadata cloud (AWS/GCP)
    "172.16.0.1", "172.31.255.255", "192.0.0.8", "192.168.1.1", "198.18.0.1", "198.19.255.255",
    "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255",
  ]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
});

test("IPv4 publik diizinkan, termasuk tetangga rentang internal", () => {
  for (const ip of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "198.17.255.255", "198.20.0.1", "192.169.0.1", "11.0.0.1"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("IPv6 internal ditolak, termasuk IPv4 yang disamarkan", () => {
  for (const ip of [
    "::", "::1", "0:0:0:0:0:0:0:1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", // bentuk yang dihasilkan URL WHATWG dari [::ffff:127.0.0.1]
    "::ffff:a9fe:a9fe",                  // 169.254.169.254
    "::ffff:10.0.0.1", "::127.0.0.1",
    "64:ff9b::7f00:1",                   // NAT64 -> 127.0.0.1
    "2002:7f00:1::",                     // 6to4 -> 127.0.0.1
    "2002:c0a8:101::1",                  // 6to4 -> 192.168.1.1
    "fc00::1", "fd12:3456::1",           // unique-local
    "fe80::1", "fe80::1%eth0",           // link-local (dengan zona)
    "ff02::1",                           // multicast
  ]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
});

test("IPv6 publik diizinkan", () => {
  for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::1"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("yang bukan alamat IP dianggap tidak aman", () => {
  for (const v of ["", "localhost", "example.com", "127.1", "0x7f000001", "2130706433", "1.2.3", "::gggg", null, undefined, 123]) {
    assert.equal(isPrivateAddress(v), true, String(v));
  }
});
