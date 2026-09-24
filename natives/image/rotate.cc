#include <vips/vips8>

#include "common.h"

using namespace std;
using namespace vips;

FunctionArgs esmb::Image::RotateArgs = {
  {"degrees", {typeid(int), false}}
};

CmdOutput esmb::Image::Rotate(const string &type, string &outType, const char *bufferdata, size_t bufferLength,
                              esmb::ArgumentMap arguments, bool *shouldKill) {
  int degrees = GetArgumentWithFallback<int>(arguments, "degrees", 90);

  VImage in = VImage::new_from_buffer(bufferdata, bufferLength, "", GetInputOptions(type, false, false));

  int pageHeight = vips_image_get_page_height(in.get_image());
  int nPages = type == "avif" ? 1 : vips_image_get_n_pages(in.get_image());

  VipsAngle angle;
  if (degrees == 90) angle = VIPS_ANGLE_D90;
  else if (degrees == 180) angle = VIPS_ANGLE_D180;
  else if (degrees == 270) angle = VIPS_ANGLE_D270;
  else angle = VIPS_ANGLE_D90;

  vector<VImage> frames;
  for (int i = 0; i < nPages; i++) {
    VImage frame = nPages > 1 ? in.crop(0, i * pageHeight, in.width(), pageHeight) : in;
    SetupTimeoutCallback(frame, shouldKill);
    frames.push_back(frame.rot(angle));
  }

  VImage out = nPages > 1 ? VImage::arrayjoin(frames, VImage::option()->set("across", 1)) : frames[0];
  if (nPages > 1) {
    int outPageHeight = frames[0].height();
    out.set(VIPS_META_PAGE_HEIGHT, outPageHeight);
  }
  outType = type;

  void *buf;
  size_t dataSize;
  out.write_to_buffer(("." + outType).c_str(), &buf, &dataSize);
  return {static_cast<char *>(buf), dataSize};
}
