
const start = () => {
  if (!window.LoreApp || !window.VaultDesignSystem_ffbf58) {return setTimeout(start, 40);}
  const LoreApp = window.LoreApp;
  ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(LoreApp, null));
};
start();