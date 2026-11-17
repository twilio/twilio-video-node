/*
 * Stand-in for the OpenH264 library, for testing the loader without Cisco's
 * binary. It exports the entry points the loader resolves and reports the
 * version given by STUB_MAJOR, STUB_MINOR and STUB_REVISION at compile time.
 * Define STUB_OMIT_DECODER to leave WelsCreateDecoder out.
 */

typedef struct {
  unsigned int uMajor;
  unsigned int uMinor;
  unsigned int uRevision;
  unsigned int uReserved;
} OpenH264Version;

OpenH264Version WelsGetCodecVersion(void) {
  OpenH264Version version = {STUB_MAJOR, STUB_MINOR, STUB_REVISION, 0};
  return version;
}

int WelsCreateSVCEncoder(void** encoder) {
  *encoder = 0;
  return 1;
}

void WelsDestroySVCEncoder(void* encoder) {
  (void)encoder;
}

#ifndef STUB_OMIT_DECODER
long WelsCreateDecoder(void** decoder) {
  *decoder = 0;
  return 1;
}
#endif

void WelsDestroyDecoder(void* decoder) {
  (void)decoder;
}
