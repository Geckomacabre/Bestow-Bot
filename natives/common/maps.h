#pragma once

#include <vector>

#include "../image/commands.h"
#include "argmap.h"

namespace esmb {
  namespace Image {
    const std::map<std::string, CmdOutput (*)(const std::string &, std::string &, const char *, size_t, esmb::ArgumentMap, bool *)> FunctionMap = {
      {"blur",        &Blur        },
      {"bounce",      &Bounce      },
      {"caption",     &Caption     },
      {"captionTwo",  &CaptionTwo  },
      {"circle",      &Circle      },
      {"colors",      &Colors      },
      {"crop",        &Crop        },
      {"deepfry",     &Deepfry     },
      {"distort",     &Distort     },
      {"fade",        &Fade        },
      {"flag",        &Flag        },
      {"flip",        &Flip        },
      {"freeze",      &Freeze      },
      {"gamexplain",  &Gamexplain  },
      {"globe",       &Globe       },
      {"invert",      &Invert      },
      {"jpeg",        &Jpeg        },
#ifdef MAGICK_ENABLED
      {"magik",       &Magik       },
#endif
      {"meme",        &Meme        },
      {"mirror",      &Mirror      },
      {"motivate",    &Motivate    },
#ifdef ZXING_ENABLED
      {"qrRead",      &QrRead      },
#endif
      {"reddit",      &Reddit      },
      {"rotate",      &Rotate      },
      {"resize",      &Resize      },
      {"reverse",     &Reverse     },
      {"scott",       &Scott       },
      {"slide",       &Slide       },
      {"snapchat",    &Snapchat    },
      {"speed",       &Speed       },
      {"spin",        &Spin        },
      {"spotify",     &Spotify     },
      {"squish",      &Squish      },
      {"swirl",       &Swirl       },
      {"tile",        &Tile        },
      {"togif",       &ToGif       },
      {"uncanny",     &Uncanny     },
      {"uncaption",   &Uncaption   },
      {"wall",        &Wall        },
      {"watermark",   &Watermark   },
      {"whisper",     &Whisper     },
    };

    const std::map<std::string, CmdOutput (*)(const std::string &, std::string &, esmb::ArgumentMap, bool *)> NoInputFunctionMap = {
      {"homebrew", &Homebrew},
#ifdef ZXING_ENABLED
      {"qrCreate", &QrCreate},
#endif
      {"sonic",    &Sonic   },
    };

    const std::vector<std::string> AnimFunctions = {
      "freeze",
      "reverse",
      "speed",
    };

    const std::map<std::string, FunctionArgs *> FunctionArgsMap = {
      {"blur",       &BlurArgs      },
      {"caption",    &CaptionArgs   },
      {"captionTwo", &CaptionTwoArgs},
      {"colors",     &ColorsArgs    },
      {"distort",    &DistortArgs   },
      {"fade",       &FadeArgs      },
      {"flag",       &FlagArgs      },
      {"flip",       &FlipArgs      },
      {"freeze",     &FreezeArgs    },
      {"gamexplain", &GamexplainArgs},
      {"globe",      &GlobeArgs     },
      {"homebrew",   &HomebrewArgs  },
      {"jpeg",       &JpegArgs      },
      {"meme",       &MemeArgs      },
      {"mirror",     &MirrorArgs    },
      {"motivate",   &MotivateArgs  },
#ifdef ZXING_ENABLED
      {"qrCreate",   &QrCreateArgs  },
#endif
      {"reddit",     &RedditArgs    },
      {"rotate",     &RotateArgs    },
      {"resize",     &ResizeArgs    },
      {"reverse",    &ReverseArgs   },
      {"scott",      &ScottArgs     },
      {"slide",      &SlideArgs     },
      {"snapchat",   &SnapchatArgs  },
      {"sonic",      &SonicArgs     },
      {"speed",      &SpeedArgs     },
      {"spin",       &SpinArgs      },
      {"spotify",    &SpotifyArgs   },
      {"uncanny",    &UncannyArgs   },
      {"uncaption",  &UncaptionArgs },
      {"watermark",  &WatermarkArgs },
      {"whisper",    &WhisperArgs   },
    };
  } // namespace Image
} // namespace esmb
