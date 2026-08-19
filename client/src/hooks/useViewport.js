import { useEffect, useState } from 'react';
import { MOBILE_BREAKPOINT_PX } from '../breakpoints';

// ===================================================================
// 【2026-08-19追加: スマホ対応】
// 現在のウィンドウ幅がスマートフォン相当(MOBILE_BREAKPOINT_PX未満)かどうかを
// 返すだけの小さなフック。各ページはこの isMobile を makeStyles(theme, isMobile)
// のように渡し、多列グリッド→1列、固定px幅→流動幅、といった分岐に使う。
//
// window.innerWidthの変化(画面回転・ブラウザのウィンドウサイズ変更)を
// resizeイベントで検知して再計算する。SSRは行っていないアプリのため
// window未定義のケースは考慮不要だが、念のため型チェックだけ入れておく。
// ===================================================================
function computeIsMobile() {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < MOBILE_BREAKPOINT_PX;
}

export function useViewport() {
  const [isMobile, setIsMobile] = useState(computeIsMobile);

  useEffect(() => {
    const onResize = () => setIsMobile(computeIsMobile());
    window.addEventListener('resize', onResize);
    // スマホの回転(縦⇔横)はresizeとは別にorientationchangeが飛ぶ端末もあるため、
    // 念のため両方購読しておく(resizeのみで拾えない場合の保険)。
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  return { isMobile };
}
