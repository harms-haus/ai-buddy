import { describe, it, expect } from "vitest";
import { detectMediaType, nameMatchScore } from "./ha-music.js";

describe("detectMediaType", () => {
  // Playlist keywords
  it('detects "playlist" keyword', () => {
    expect(detectMediaType("play my playlist")).toBe("playlist");
  });
  it('detects "mix" keyword', () => {
    expect(detectMediaType("search for a mix of pop songs")).toBe("playlist");
  });
  it('detects "mixtape" keyword', () => {
    expect(detectMediaType("play my mixtape")).toBe("playlist");
  });

  // Track keywords
  it('detects "song" keyword', () => {
    expect(detectMediaType("play the song happy")).toBe("track");
  });
  it('detects "track" keyword', () => {
    expect(detectMediaType("find a track called hello")).toBe("track");
  });
  it('detects "tune" keyword', () => {
    expect(detectMediaType("find a tune called hello")).toBe("track");
  });
  it('detects "jam" keyword', () => {
    expect(detectMediaType("search for that jam")).toBe("track");
  });

  // Album keywords
  it('detects "album" keyword', () => {
    expect(detectMediaType("play the album thriller")).toBe("album");
  });
  it('detects "record" keyword', () => {
    expect(detectMediaType("find the record dark side of the moon")).toBe("album");
  });
  it('detects "lp" keyword', () => {
    expect(detectMediaType("play the lp thriller")).toBe("album");
  });

  // Artist keywords
  it('detects "artist" keyword', () => {
    expect(detectMediaType("find the artist taylor swift")).toBe("artist");
  });
  it('detects "singer" keyword', () => {
    expect(detectMediaType("search for the singer taylor swift")).toBe("artist");
  });
  it('detects "musician" keyword', () => {
    expect(detectMediaType("play musician bob dylan")).toBe("artist");
  });
  it('detects "performer" keyword', () => {
    expect(detectMediaType("find a performer who sings opera")).toBe("artist");
  });
  it('detects "vocalist" keyword', () => {
    expect(detectMediaType("find a vocalist who sings opera")).toBe("artist");
  });

  // No keyword
  it('returns null for query without type keyword', () => {
    expect(detectMediaType("play taylor swift")).toBeNull();
  });
  it('returns null for simple search query', () => {
    expect(detectMediaType("search for frozen")).toBeNull();
  });

  // Case insensitive
  it('handles uppercase keywords', () => {
    expect(detectMediaType("PLAY THE SONG HAPPY")).toBe("track");
  });
  it('handles mixed case keywords', () => {
    expect(detectMediaType("play the Playlist now")).toBe("playlist");
  });

  // Single keyword
  it('handles single keyword query', () => {
    expect(detectMediaType("playlist")).toBe("playlist");
  });

  // Multiple different type keywords → null
  it('returns null when multiple different type keywords are present', () => {
    expect(detectMediaType("play the song from that artist")).toBeNull();
  });
  it('returns null when album and song keywords are present', () => {
    expect(detectMediaType("play the album song")).toBeNull();
  });

  // Same keyword type repeated → still detected
  it('handles repeated same-type keywords', () => {
    expect(detectMediaType("play the song my favorite song")).toBe("track");
  });
});

describe("nameMatchScore", () => {
  it('returns 1.0 for exact match', () => {
    expect(nameMatchScore("Golden", "Golden")).toBe(1.0);
  });

  it('returns 1.0 for case + punctuation insensitive match', () => {
    expect(nameMatchScore("K-pop Demon Hunters", "K-Pop Demon Hunters")).toBe(1.0);
  });

  it('returns correct fraction for partial match', () => {
    const score = nameMatchScore("golden", "Golden from K-pop Demon Hunters");
    expect(score).toBeCloseTo(0.2, 1);
  });

  it('returns 0 when no words match', () => {
    expect(nameMatchScore("K-pop Demon Hunters", "Golden")).toBe(0);
  });

  it('returns 0 for empty name', () => {
    expect(nameMatchScore("test", "")).toBe(0);
  });

  it('returns 0 for empty query', () => {
    expect(nameMatchScore("", "anything")).toBe(0);
  });

  it('returns correct score for multi-word query', () => {
    const score = nameMatchScore("kpop demon hunters", "K-Pop Demon Hunters Playlist");
    expect(score).toBeCloseTo(0.75, 1);
  });
});
