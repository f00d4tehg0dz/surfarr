'use strict';

// Read-only HTTP client for the user's VPS MongoDB API.
// SurfArr NEVER writes to the remote API — it only reads video metadata.
// The remote API is expected to return arrays of video objects per decade+category.

const axios = require('axios');
const config = require('../config');

function createClient() {
  return axios.create({
    baseURL: config.remoteApiUrl,
    timeout: 15000,
  });
}

// Fetch all videos for a specific decade + category combination.
// Expected response shape: [{ id, title, description, duration, thumbnailUrl }, ...]
async function fetchChannelVideos(decade, category) {
  if (!config.remoteApiUrl) {
    throw new Error('REMOTE_API_URL is not configured');
  }
  const client = createClient();
  const response = await client.get('/videos', {
    params: { decade, category },
  });
  return response.data;
}

// Fetch all videos in a YouTube playlist by playlist ID.
async function fetchPlaylistVideos(playlistId) {
  if (!config.remoteApiUrl) {
    throw new Error('REMOTE_API_URL is not configured');
  }
  const client = createClient();
  const response = await client.get(`/playlists/${playlistId}/videos`);
  return response.data;
}

// Health check: ping the remote API to verify connectivity.
async function pingRemoteApi() {
  if (!config.remoteApiUrl) return false;
  try {
    const client = createClient();
    await client.get('/health', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// Fetch videos for a standalone channel (e.g., classic-nickelodeon, fox-kids)
async function fetchStandaloneVideos(channelId) {
  if (!config.remoteApiUrl) {
    throw new Error('REMOTE_API_URL is not configured');
  }
  const client = createClient();
  const response = await client.get(`/videos/channel/${channelId}`);
  return response.data;
}

// Fetch plugin channels from the remote API.
async function fetchPluginChannels() {
  if (!config.remoteApiUrl) return [];
  try {
    const client = createClient();
    const response = await client.get('/plugins');
    return response.data;
  } catch {
    return [];
  }
}

// Fetch videos for a specific plugin channel from the remote API.
async function fetchPluginVideos(pluginId) {
  if (!config.remoteApiUrl) {
    throw new Error('REMOTE_API_URL is not configured');
  }
  const client = createClient();
  const response = await client.get(`/plugins/${pluginId}/videos`);
  return response.data;
}

// Fetch the shared channel definition (grid + standalone + plugin + live
// channels) from the API. This is the source of truth that keeps every
// SurfArr instance's lineup in step with the API; the local grid in
// channelGrid.js is only the offline fallback.
async function fetchConfig() {
  if (!config.remoteApiUrl) return null;
  const client = createClient();
  const response = await client.get('/config', { timeout: 10000 });
  const data = response.data;
  if (!data || !Array.isArray(data.channelGrid)) throw new Error('unexpected /config payload');
  return data;
}

// Fetch 24/7 live channels (also embedded in /config; this is the cheap refresh).
async function fetchLiveChannels() {
  if (!config.remoteApiUrl) return [];
  try {
    const client = createClient();
    const response = await client.get('/live', { timeout: 10000 });
    return Array.isArray(response.data) ? response.data : [];
  } catch {
    return [];
  }
}

module.exports = {
  fetchChannelVideos,
  fetchPlaylistVideos,
  pingRemoteApi,
  fetchPluginChannels,
  fetchPluginVideos,
  fetchStandaloneVideos,
  fetchConfig,
  fetchLiveChannels,
};