Polycamでスキャンした自室のモデルをここに配置してください。

【推奨】
Polycamアプリのエクスポート機能で GLB (.glb / 単一バイナリファイル) 形式を選び、
このフォルダに room.glb という名前で置いてください。

  client/public/models/room.glb

配置すると、見守りダッシュボード（src/config.js の ROOM_MODEL_PATH）と
「Polycamの動作確認」画面の②から自動的に読み込まれます。

【GLTF (.gltf + .bin + テクスチャ) 形式の場合】
複数ファイル一式をこのフォルダにそのままコピーし、
src/config.js の ROOM_MODEL_PATH を実際のファイル名（例: /models/room.gltf）に
書き換えてください。

【ファイルが無い場合】
自動的にプレースホルダーの部屋（箱の集合）が表示されます。
アプリの動作確認には支障ありません。準備ができ次第、置き換えてください。
