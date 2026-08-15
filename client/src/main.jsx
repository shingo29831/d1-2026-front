import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
// Amplify(Cognito)の初期設定。App.jsxやLoginPage.jsxがAmplifyのAuth関数を
// 呼び出す前に一度だけ実行しておく必要があるため、エントリーポイントでimportする。
import './amplifyConfig.js'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)