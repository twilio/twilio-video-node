import { describe, it, beforeAll, expect } from 'vitest';
import { getVersion, setLogLevel, MediaFactory } from '../lib/index.js';
import { generateI420Frame, generateAudioSamples } from './helpers/media.js';

describe('Version', () => {
    it('getVersion returns string', () => {
        const version = getVersion();
        expect(typeof version).toBe('string');
        expect(version.length).toBeGreaterThan(0);
    });
});

describe('Log Level', () => {
    it('setLogLevel accepts valid levels', () => {
        const levels = ['off', 'fatal', 'error', 'warning', 'info', 'debug', 'trace', 'all'];
        levels.forEach(level => {
            expect(() => setLogLevel(level)).not.toThrow();
        });
    });

    it('setLogLevel rejects invalid level', () => {
        expect(() => setLogLevel('invalid')).toThrow(/Invalid log level/);
    });
});

describe('MediaFactory', () => {
    let factory;

    beforeAll(() => {
        factory = new MediaFactory();
    });

    describe('Video Track', () => {
        it('createVideoTrack creates track', () => {
            const track = factory.createVideoTrack({
                name: 'test-video',
                width: 640,
                height: 480
            });

            expect(track).toBeDefined();
            expect(track.name).toBe('test-video');
            expect(track.enabled).toBe(true);
        });

        it('track can be disabled', () => {
            const track = factory.createVideoTrack({
                name: 'disable-test',
                width: 320,
                height: 240
            });

            track.enabled = false;
            expect(track.enabled).toBe(false);

            track.enabled = true;
            expect(track.enabled).toBe(true);
        });

        it('pushFrame accepts I420 frame', () => {
            const track = factory.createVideoTrack({
                name: 'push-test',
                width: 320,
                height: 240
            });

            const frame = generateI420Frame(320, 240);
            expect(() => {
                track.pushFrame(frame.y, frame.u, frame.v, 320, 240);
            }).not.toThrow();
        });
    });

    describe('Audio Track', () => {
        it('createAudioTrack creates track', () => {
            const track = factory.createAudioTrack({
                name: 'test-audio',
                sampleRate: 48000,
                channels: 1
            });

            expect(track).toBeDefined();
            expect(track.name).toBe('test-audio');
            expect(track.enabled).toBe(true);
        });

        it('track can be disabled', () => {
            const track = factory.createAudioTrack({
                name: 'disable-test',
                sampleRate: 48000,
                channels: 1
            });

            track.enabled = false;
            expect(track.enabled).toBe(false);

            track.enabled = true;
            expect(track.enabled).toBe(true);
        });

        it('pushSamples accepts audio samples', () => {
            const track = factory.createAudioTrack({
                name: 'push-test',
                sampleRate: 48000,
                channels: 1
            });

            const samples = generateAudioSamples(480, 48000, 1);
            expect(() => {
                track.pushSamples(samples, 48000, 1);
            }).not.toThrow();
        });
    });
});
