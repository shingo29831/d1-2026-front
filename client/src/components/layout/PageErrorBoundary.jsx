import React from 'react';

// アプリ全体の最後の安全網。以前はどの階層にもエラー境界が無かったため、
// (特に3D表示まわりで)何らかの想定外の例外が発生すると、Reactのツリー
// 全体がアンマウントされて画面が「真っ白」になり、リロードするまで何も
// 操作できなくなってしまっていた。ここでページ本文全体を包み、万一エラーが
// 起きてもヘッダーは表示されたままにし、ページ再読み込みを促す案内を出す
// (各3D表示コンポーネント自身にもより局所的なCanvas3DErrorBoundaryを
// 置いているため、通常はそちらで止まり、ここまで来ることは無い想定だが、
// 想定していない場所で例外が起きた場合の最終防御として用意している)。
export default class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('ページの表示中にエラーが発生しました:', error, info);
  }

  componentDidUpdate(prevProps) {
    // resetKey(表示中のページ名など)が変わったら、次にまたこのページへ
    // 戻ってきたときに再挑戦できるようエラー状態をリセットする。
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={styles.wrap}>
          <div style={styles.icon}>⚠</div>
          <div style={styles.title}>このページの表示中にエラーが発生しました</div>
          <div style={styles.text}>
            お手数ですが、ページを再読み込みするか、メニューから他の画面へ移動してから
            もう一度お試しください。
          </div>
          <button onClick={() => window.location.reload()} style={styles.btn}>
            ページを再読み込み
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const styles = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '60vh',
    gap: 12,
    padding: 32,
    textAlign: 'center',
    color: '#94a3b8',
  },
  icon: { fontSize: 32 },
  title: { fontSize: 16, fontWeight: 700, color: '#e2e8f0' },
  text: { fontSize: 13, lineHeight: 1.7, maxWidth: 420 },
  btn: {
    fontSize: 13,
    padding: '9px 22px',
    borderRadius: 8,
    border: '1px solid #475569',
    background: 'transparent',
    color: '#cbd5e1',
    cursor: 'pointer',
    marginTop: 6,
  },
};
