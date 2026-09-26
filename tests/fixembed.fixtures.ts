/**
 * Real answers from the two embed fixers, made by running their own code on made-up posts: OGInstagram's buildMastodonStatus
 * (server/mastodon.go, github.com/seirenkr/OGInstagram) and fxTikTok's generateActivity (src/util/generateActivity.tsx,
 * github.com/okdargy/fxTikTok). Only the fields Bestow reads are kept. The OGInstagram links are signed with its test key.
 */
export const FIXTURES = {
 "og": {
  "reelId": "3623867412166171356629942272174570899061500750620766579791602478114",
  "postId": "11709347132057179036476208038078336353826",
  "item3Id": "3295888211292781095399070407435142910821747584428816947",
  "reel": {
   "url": "https://oginstagram.com/reel/CxAbCdEfGhI",
   "created_at": "2026-04-07T16:48:30.000Z",
   "content": "<p><b>▶️ 1,234,567  ❤️ 88,231  💬 6,854</b></p><p>Dancing<br><br>with <a href=\"https://www.instagram.com/nasa\">@nasa</a> &amp; <a href=\"https://www.instagram.com/explore/search/keyword/?q=%23friends\">#friends</a> &lt;3</p>",
   "account": {
    "username": "britneyspears",
    "display_name": "Britney Spears",
    "avatar": "https://oginstagram.com/offload/CxAbCdEfGhI/avatar?v=2&kid=test-v1&exp=1791602301&sig=ahsv8Gv4lW4MhI9jUJgwg5y_4QQVdzZXQQWH0mTScvE",
    "url": "https://www.instagram.com/britneyspears/"
   },
   "media_attachments": [
    {
     "type": "video",
     "url": "https://oginstagram.com/offload/CxAbCdEfGhI/1?v=2&kid=test-v1&exp=1791602301&sig=WIHAe8ochJ_Xl3AKgaVn4BHESaHOAcAUOu0YmjSq9P0",
     "preview_url": "https://oginstagram.com/offload/CxAbCdEfGhI/1?thumbnail=1&v=2&kid=test-v1&exp=1791602301&sig=WIHAe8ochJ_Xl3AKgaVn4BHESaHOAcAUOu0YmjSq9P0",
     "description": null
    }
   ]
  },
  "carousel": {
   "url": "https://oginstagram.com/p/DW1nTDiDvnF",
   "created_at": "2026-04-07T16:48:30.000Z",
   "content": "<p><b>🖼️ 6  ❤️ 11,101,714  💬 46,439</b></p><p>Hello, Moon.</p>",
   "account": {
    "username": "nasa",
    "display_name": "NASA",
    "avatar": "https://oginstagram.com/default-avatar.jpg",
    "url": "https://www.instagram.com/nasa/"
   },
   "media_attachments": [
    {
     "type": "image",
     "url": "https://oginstagram.com/offload/DW1nTDiDvnF/1?v=2&kid=test-v1&exp=1791602301&sig=OxYZfeFVK-TuA3WjBNs8sOK28jWwYhdlsf6HyFzy7Bw",
     "preview_url": "https://oginstagram.com/offload/DW1nTDiDvnF/1?v=2&kid=test-v1&exp=1791602301&sig=OxYZfeFVK-TuA3WjBNs8sOK28jWwYhdlsf6HyFzy7Bw",
     "description": null
    },
    {
     "type": "image",
     "url": "https://oginstagram.com/offload/DW1nTDiDvnF/2?v=2&kid=test-v1&exp=1791602301&sig=VbQar2UPJwRbpkJmmx59yw-8Rs25Y9H4W7lHi9HBmBM",
     "preview_url": "https://oginstagram.com/offload/DW1nTDiDvnF/2?v=2&kid=test-v1&exp=1791602301&sig=VbQar2UPJwRbpkJmmx59yw-8Rs25Y9H4W7lHi9HBmBM",
     "description": null
    },
    {
     "type": "image",
     "url": "https://oginstagram.com/offload/DW1nTDiDvnF/4?v=2&kid=test-v1&exp=1791602301&sig=h-mTxKcjl81Rw_VgQpgnvl04QkrlC-zR4ZqWII5UGjg",
     "preview_url": "https://oginstagram.com/offload/DW1nTDiDvnF/4?v=2&kid=test-v1&exp=1791602301&sig=h-mTxKcjl81Rw_VgQpgnvl04QkrlC-zR4ZqWII5UGjg",
     "description": null
    },
    {
     "type": "image",
     "url": "https://oginstagram.com/offload/DW1nTDiDvnF/5?v=2&kid=test-v1&exp=1791602301&sig=CsQGXeIm9jIRiTbh_pYMJW5oozJbvmPsVX1VyKPhnOI",
     "preview_url": "https://oginstagram.com/offload/DW1nTDiDvnF/5?v=2&kid=test-v1&exp=1791602301&sig=CsQGXeIm9jIRiTbh_pYMJW5oozJbvmPsVX1VyKPhnOI",
     "description": null
    }
   ]
  },
  "carouselItems": [
   {
    "url": "https://oginstagram.com/p/DW1nTDiDvnF",
    "created_at": "2026-04-07T16:48:30.000Z",
    "content": "<p><b>🖼️ 1 / 6  ❤️ 11,101,714  💬 46,439</b></p><p>Hello, Moon.</p>",
    "account": {
     "username": "nasa",
     "display_name": "NASA",
     "avatar": "https://oginstagram.com/default-avatar.jpg",
     "url": "https://www.instagram.com/nasa/"
    },
    "media_attachments": [
     {
      "type": "image",
      "url": "https://oginstagram.com/offload/DW1nTDiDvnF/1?v=2&kid=test-v1&exp=1791602301&sig=OxYZfeFVK-TuA3WjBNs8sOK28jWwYhdlsf6HyFzy7Bw",
      "preview_url": "https://oginstagram.com/offload/DW1nTDiDvnF/1?v=2&kid=test-v1&exp=1791602301&sig=OxYZfeFVK-TuA3WjBNs8sOK28jWwYhdlsf6HyFzy7Bw",
      "description": null
     }
    ]
   },
   {
    "url": "https://oginstagram.com/p/DW1nTDiDvnF",
    "created_at": "2026-04-07T16:48:30.000Z",
    "content": "<p><b>🖼️ 2 / 6  ❤️ 11,101,714  💬 46,439</b></p><p>Hello, Moon.</p>",
    "account": {
     "username": "nasa",
     "display_name": "NASA",
     "avatar": "https://oginstagram.com/default-avatar.jpg",
     "url": "https://www.instagram.com/nasa/"
    },
    "media_attachments": [
     {
      "type": "image",
      "url": "https://oginstagram.com/offload/DW1nTDiDvnF/2?v=2&kid=test-v1&exp=1791602301&sig=VbQar2UPJwRbpkJmmx59yw-8Rs25Y9H4W7lHi9HBmBM",
      "preview_url": "https://oginstagram.com/offload/DW1nTDiDvnF/2?v=2&kid=test-v1&exp=1791602301&sig=VbQar2UPJwRbpkJmmx59yw-8Rs25Y9H4W7lHi9HBmBM",
      "description": null
     }
    ]
   },
   {
    "url": "https://oginstagram.com/p/DW1nTDiDvnF",
    "created_at": "2026-04-07T16:48:30.000Z",
    "content": "<p><b>🖼️ 3 / 6  ❤️ 11,101,714  💬 46,439</b></p><p>Hello, Moon.</p>",
    "account": {
     "username": "nasa",
     "display_name": "NASA",
     "avatar": "https://oginstagram.com/default-avatar.jpg",
     "url": "https://www.instagram.com/nasa/"
    },
    "media_attachments": [
     {
      "type": "video",
      "url": "https://oginstagram.com/offload/DW1nTDiDvnF/3?v=2&kid=test-v1&exp=1791602301&sig=XmbNkzGVTciZdHY7-zS5ZFL_V1KN__x6aZCZN9W4xFU",
      "preview_url": "https://oginstagram.com/offload/DW1nTDiDvnF/3?thumbnail=1&v=2&kid=test-v1&exp=1791602301&sig=XmbNkzGVTciZdHY7-zS5ZFL_V1KN__x6aZCZN9W4xFU",
      "description": null
     }
    ]
   },
   {
    "url": "https://oginstagram.com/p/DW1nTDiDvnF",
    "created_at": "2026-04-07T16:48:30.000Z",
    "content": "<p><b>🖼️ 4 / 6  ❤️ 11,101,714  💬 46,439</b></p><p>Hello, Moon.</p>",
    "account": {
     "username": "nasa",
     "display_name": "NASA",
     "avatar": "https://oginstagram.com/default-avatar.jpg",
     "url": "https://www.instagram.com/nasa/"
    },
    "media_attachments": [
     {
      "type": "image",
      "url": "https://oginstagram.com/offload/DW1nTDiDvnF/4?v=2&kid=test-v1&exp=1791602301&sig=h-mTxKcjl81Rw_VgQpgnvl04QkrlC-zR4ZqWII5UGjg",
      "preview_url": "https://oginstagram.com/offload/DW1nTDiDvnF/4?v=2&kid=test-v1&exp=1791602301&sig=h-mTxKcjl81Rw_VgQpgnvl04QkrlC-zR4ZqWII5UGjg",
      "description": null
     }
    ]
   },
   {
    "url": "https://oginstagram.com/p/DW1nTDiDvnF",
    "created_at": "2026-04-07T16:48:30.000Z",
    "content": "<p><b>🖼️ 5 / 6  ❤️ 11,101,714  💬 46,439</b></p><p>Hello, Moon.</p>",
    "account": {
     "username": "nasa",
     "display_name": "NASA",
     "avatar": "https://oginstagram.com/default-avatar.jpg",
     "url": "https://www.instagram.com/nasa/"
    },
    "media_attachments": [
     {
      "type": "image",
      "url": "https://oginstagram.com/offload/DW1nTDiDvnF/5?v=2&kid=test-v1&exp=1791602301&sig=CsQGXeIm9jIRiTbh_pYMJW5oozJbvmPsVX1VyKPhnOI",
      "preview_url": "https://oginstagram.com/offload/DW1nTDiDvnF/5?v=2&kid=test-v1&exp=1791602301&sig=CsQGXeIm9jIRiTbh_pYMJW5oozJbvmPsVX1VyKPhnOI",
      "description": null
     }
    ]
   },
   {
    "url": "https://oginstagram.com/p/DW1nTDiDvnF",
    "created_at": "2026-04-07T16:48:30.000Z",
    "content": "<p><b>🖼️ 6 / 6  ❤️ 11,101,714  💬 46,439</b></p><p>Hello, Moon.</p>",
    "account": {
     "username": "nasa",
     "display_name": "NASA",
     "avatar": "https://oginstagram.com/default-avatar.jpg",
     "url": "https://www.instagram.com/nasa/"
    },
    "media_attachments": [
     {
      "type": "image",
      "url": "https://oginstagram.com/offload/DW1nTDiDvnF/6?v=2&kid=test-v1&exp=1791602301&sig=S_iVj_rRTSXVSO1ssYwHHDtacOeoRvoDw1ZeneXOdog",
      "preview_url": "https://oginstagram.com/offload/DW1nTDiDvnF/6?v=2&kid=test-v1&exp=1791602301&sig=S_iVj_rRTSXVSO1ssYwHHDtacOeoRvoDw1ZeneXOdog",
      "description": null
     }
    ]
   }
  ],
  "noPic": {
   "url": "https://oginstagram.com/p/DAbc",
   "created_at": "2026-04-07T16:48:30.000Z",
   "content": "<p><b>❤️ 0  💬 0</b></p>",
   "account": {
    "username": "someone",
    "display_name": "someone",
    "avatar": "https://oginstagram.com/default-avatar.jpg",
    "url": "https://www.instagram.com/someone/"
   },
   "media_attachments": [
    {
     "type": "image",
     "url": "https://oginstagram.com/offload/DAbc/1?v=2&kid=test-v1&exp=1791602301&sig=dhUcbm-RRTlgQAoHOL5qtiPXvg5B_6Y-eVkvfMrJ6Pw",
     "preview_url": "https://oginstagram.com/offload/DAbc/1?v=2&kid=test-v1&exp=1791602301&sig=dhUcbm-RRTlgQAoHOL5qtiPXvg5B_6Y-eVkvfMrJ6Pw",
     "description": null
    }
   ]
  }
 },
 "tnk": {
  "video": {
   "url": "https://tiktok.com/@bob.smith/video/7412345678901234567",
   "created_at": "2024-09-10T20:26:40.000Z",
   "content": "hello <a href=\"https://tiktok.com/@alice\">@alice</a> <a href=\"https://www.tiktok.com/tag/fyp\">#fyp</a> & more<br><br><b>❤️ 1.2M 💬 8.9K 🔁 345</b>",
   "account": {
    "username": "bob.smith",
    "display_name": "Bob <Smith> ☑️",
    "avatar": "https://offload.tnktok.com/generate/pfp/6800000000000000001",
    "url": "https://tiktok.com/@bob.smith"
   },
   "media_attachments": [
    {
     "type": "video",
     "url": "https://offload.tnktok.com/generate/video/7412345678901234567",
     "preview_url": "https://offload.tnktok.com/generate/cover/7412345678901234567",
     "description": null
    }
   ]
  },
  "photos1": {
   "url": "https://tiktok.com/@bob.smith/video/7412345678901234568?page=1",
   "created_at": "2024-09-10T20:26:40.000Z",
   "content": "<b>My <trip></b><br>seven pics<br><br><b>❤️ 1.2M 💬 8.9K 🔁 345</b>",
   "account": {
    "username": "bob.smith",
    "display_name": "Bob <Smith> ☑️",
    "avatar": "https://offload.tnktok.com/generate/pfp/6800000000000000001",
    "url": "https://tiktok.com/@bob.smith"
   },
   "media_attachments": [
    {
     "type": "image",
     "url": "https://offload.tnktok.com/generate/image/7412345678901234568/1",
     "preview_url": "https://offload.tnktok.com/generate/image/7412345678901234568/1?preview=true",
     "description": "Image (1 of 7)"
    },
    {
     "type": "image",
     "url": "https://offload.tnktok.com/generate/image/7412345678901234568/2",
     "preview_url": "https://offload.tnktok.com/generate/image/7412345678901234568/2?preview=true",
     "description": "Image (2 of 7)"
    },
    {
     "type": "image",
     "url": "https://offload.tnktok.com/generate/image/7412345678901234568/3",
     "preview_url": "https://offload.tnktok.com/generate/image/7412345678901234568/3?preview=true",
     "description": "Image (3 of 7)"
    },
    {
     "type": "image",
     "url": "https://offload.tnktok.com/generate/image/7412345678901234568/4",
     "preview_url": "https://offload.tnktok.com/generate/image/7412345678901234568/4?preview=true",
     "description": "Image (4 of 7)"
    }
   ]
  },
  "photos2": {
   "url": "https://tiktok.com/@bob.smith/video/7412345678901234568?page=2",
   "created_at": "2024-09-10T20:26:40.000Z",
   "content": "<b>My <trip></b><br>seven pics<br><br><b>❤️ 1.2M 💬 8.9K 🔁 345</b>",
   "account": {
    "username": "bob.smith",
    "display_name": "Bob <Smith> ☑️",
    "avatar": "https://offload.tnktok.com/generate/pfp/6800000000000000001",
    "url": "https://tiktok.com/@bob.smith"
   },
   "media_attachments": [
    {
     "type": "image",
     "url": "https://offload.tnktok.com/generate/image/7412345678901234568/5",
     "preview_url": "https://offload.tnktok.com/generate/image/7412345678901234568/5?preview=true",
     "description": "Image (5 of 7)"
    },
    {
     "type": "image",
     "url": "https://offload.tnktok.com/generate/image/7412345678901234568/6",
     "preview_url": "https://offload.tnktok.com/generate/image/7412345678901234568/6?preview=true",
     "description": "Image (6 of 7)"
    },
    {
     "type": "image",
     "url": "https://offload.tnktok.com/generate/image/7412345678901234568/7",
     "preview_url": "https://offload.tnktok.com/generate/image/7412345678901234568/7?preview=true",
     "description": "Image (7 of 7)"
    }
   ]
  },
  "small": {
   "url": "https://tiktok.com/@bob.smith/video/7412345678901234569",
   "created_at": "2024-09-10T20:26:40.000Z",
   "content": "<br><br><b>❤️ 0 💬 999 🔁 1K</b>",
   "account": {
    "username": "bob.smith",
    "display_name": "Plain",
    "avatar": "https://offload.tnktok.com/generate/pfp/6800000000000000001",
    "url": "https://tiktok.com/@bob.smith"
   },
   "media_attachments": [
    {
     "type": "video",
     "url": "https://offload.tnktok.com/generate/video/7412345678901234569",
     "preview_url": "https://offload.tnktok.com/generate/cover/7412345678901234569",
     "description": null
    }
   ]
  }
 }
};
