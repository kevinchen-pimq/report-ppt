using IPA;
using UnityEngine;
using IPALogger = IPA.Logging.Logger;

namespace BSRemote {
	[Plugin(RuntimeOptions.SingleStartInit)]
	public class Plugin {
		internal static IPALogger Log;

		[Init]
		public void Init(IPALogger logger) {
			Log = logger;
		}

		[OnStart]
		public void OnStart() {
			var go = new GameObject("BSRemote");
			Object.DontDestroyOnLoad(go);
			go.AddComponent<RemoteController>();
		}

		[OnExit]
		public void OnExit() {
			RemoteController.Instance?.Shutdown();
		}
	}
}
