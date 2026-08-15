import React from 'react';

// react-three-fiber の Suspense は「読み込み中」は拾えるが、
// GLTFの404/パースエラーなどの「失敗」はErrorBoundaryでないと拾えない。
// Polycamのモデルがまだ配置されていない場合に備えてフォールバック表示を行う。
export default class GltfErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.warn('GLTFモデルの読み込みに失敗しました。プレースホルダーの部屋を表示します。', error);
  }

  componentDidUpdate(prevProps) {
    // resetKeyが変わったら再挑戦できるようにエラー状態をリセット
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
