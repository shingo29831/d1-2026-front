import React from 'react';

// react-three-fiber の<Canvas>内(またはその周辺)で予期しない例外が発生すると、
// このアプリにはそれを受け止めるエラー境界がどこにも無かったため、Reactの
// ツリー全体がアンマウントされ、画面が「真っ白」になってしまっていた
// (「危険行為履歴の3Dボタンを押すと真っ白になってしまいます」という報告への対応)。
// このコンポーネントで3D表示部分だけを局所的に受け止めることで、たとえ内部で
// 何か問題が起きても、ヘッダーや絞り込みバー・履歴一覧など他の部分はそのまま
// 操作できるようにする(App.jsx側にもページ単位の同種のエラー境界を置いており、
// 二重の安全網になっている)。
export default class Canvas3DErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('3D表示中にエラーが発生しました:', error, info);
  }

  componentDidUpdate(prevProps) {
    // resetKeyが変わったら(表示モードの切り替えなど)、再挑戦できるように
    // エラー状態をリセットする。
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={styles.wrap}>
          <div style={styles.icon}>⚠</div>
          <div style={styles.text}>
            3D表示の読み込み中にエラーが発生しました。
          </div>
          <button onClick={this.handleRetry} style={styles.btn}>もう一度試す</button>
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
    width: '100%',
    height: '100%',
    minHeight: 200,
    gap: 10,
    padding: 20,
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 13,
    background: 'rgba(148,163,184,0.08)',
    borderRadius: 10,
    boxSizing: 'border-box',
  },
  icon: { fontSize: 26 },
  text: { lineHeight: 1.6, maxWidth: 320 },
  btn: {
    fontSize: 12,
    padding: '7px 18px',
    borderRadius: 7,
    border: '1px solid #475569',
    background: 'transparent',
    color: '#cbd5e1',
    cursor: 'pointer',
  },
};
