using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading;
using Camera2.Configuration;
using Camera2.SDK;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.SceneManagement;
using Reply = BSRemote.RemoteController.Reply;

namespace BSRemote {
	/// <summary>
	/// The endpoint's commands. Every one runs as a coroutine on the main thread and puts its answer
	/// into the ReplyBox. Game classes that changed between versions are reached by reflection.
	/// </summary>
	class Commands {
		internal class ReplyBox {
			public Reply reply;
		}

		readonly MonoBehaviour host;
		readonly Dictionary<string, OverrideToken> tokens = new Dictionary<string, OverrideToken>();
		bool frozen;

		public Commands(MonoBehaviour host) {
			this.host = host;
		}

		public IEnumerator Route(string method, string path, JObject a, ReplyBox box) {
			switch(path) {
				case "/state": return State(box);
				case "/environments": return Environments(box);
				case "/camera": return Camera(a, box);
				case "/camera/release": return CameraRelease(a, box);
				case "/play": return Play(a, box);
				case "/freeze": return Freeze(a, box);
				case "/resume": return Resume(box);
				case "/screenshot": return Screenshot(a, box);
				case "/shots": return Shots(a, box);
				case "/menu": return Menu(box);
				case "/refresh-songs": return RefreshSongs(box);
				case "/settings": return Settings(box);
			}
			box.reply = Reply.Error($"unknown command {path}", 404);
			return null;
		}

		// -------------------------------------------------------------------------------------------
		// helpers

		static T Find<T>() where T : UnityEngine.Object => Resources.FindObjectsOfTypeAll<T>().FirstOrDefault();

		static AudioTimeSyncController Atsc() =>
			Resources.FindObjectsOfTypeAll<AudioTimeSyncController>().FirstOrDefault(x => x != null && x.isActiveAndEnabled);

		static bool InLevel() => Atsc() != null;

		static Vector3 Vec(JToken t, Vector3 fallback) {
			if(t is JArray arr && arr.Count >= 3) return new Vector3(arr[0].Value<float>(), arr[1].Value<float>(), arr[2].Value<float>());
			return fallback;
		}

		static void SetMember(object target, object value, params string[] names) {
			var type = target.GetType();
			const BindingFlags F = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
			foreach(var n in names) {
				var p = type.GetProperty(n, F);
				if(p != null && p.CanWrite) { p.SetValue(target, value); return; }
				var f = type.GetField(n, F);
				if(f != null) { f.SetValue(target, value); return; }
			}
			throw new MissingMemberException(type.Name, string.Join("/", names));
		}

		static object GetMember(object target, string name) {
			if(target == null) return null;
			const BindingFlags F = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
			var type = target.GetType();
			var p = type.GetProperty(name, F);
			if(p != null) return p.GetValue(target);
			return type.GetField(name, F)?.GetValue(target);
		}

		/// <summary>Public fields / properties of simple types, for reporting settings.</summary>
		static Dictionary<string, object> Dump(object o) {
			var d = new Dictionary<string, object>();
			if(o == null) return d;
			foreach(var p in o.GetType().GetProperties(BindingFlags.Instance | BindingFlags.Public)) {
				if(p.GetIndexParameters().Length > 0) continue;
				var t = p.PropertyType;
				if(!(t.IsPrimitive || t.IsEnum || t == typeof(string))) continue;
				try { d[p.Name] = t.IsEnum ? p.GetValue(o).ToString() : p.GetValue(o); } catch { }
			}
			return d;
		}

		// -------------------------------------------------------------------------------------------
		// state

		IEnumerator State(ReplyBox box) {
			var atsc = Atsc();
			var scenes = new List<string>();
			for(var i = 0; i < SceneManager.sceneCount; i++) scenes.Add(SceneManager.GetSceneAt(i).name);
			box.reply = Reply.Json(new {
				ok = true,
				gameVersion = Application.version,
				scenes,
				inLevel = atsc != null,
				songTime = atsc != null ? atsc.songTime : (float?)null,
				songEndTime = atsc != null ? atsc.songEndTime : (float?)null,
				frozen,
				timeScale = Time.timeScale,
				screen = new[] { Screen.width, Screen.height },
				cameras = SafeCameras(),
			});
			yield break;
		}

		static object SafeCameras() {
			try {
				return Cameras.available.Select(n => new { name = n, type = Cameras.GetCameraType(n)?.ToString(), active = Cameras.active.Contains(n) }).ToArray();
			} catch(Exception ex) {
				return ex.Message;
			}
		}

		IEnumerator Environments(ReplyBox box) {
			var envs = Resources.FindObjectsOfTypeAll<EnvironmentInfoSO>()
				.Select(e => new { name = e.serializedName, type = e.environmentType != null ? e.environmentType.typeNameLocalizationKey : null })
				.Distinct().OrderBy(e => e.name).ToArray();
			box.reply = Reply.Json(new { ok = true, environments = envs });
			yield break;
		}

		IEnumerator Settings(ReplyBox box) {
			var pdm = Find<PlayerDataModel>();
			var pd = pdm != null ? pdm.playerData : null;
			box.reply = Reply.Json(new {
				ok = true,
				playerSpecificSettings = Dump(pd?.playerSpecificSettings),
				gameplayModifiers = Dump(pd?.gameplayModifiers),
				overrideEnvironments = pd?.overrideEnvironmentSettings?.overrideEnvironments,
				quality = QualitySettings.names[QualitySettings.GetQualityLevel()],
			});
			yield break;
		}

		// -------------------------------------------------------------------------------------------
		// camera (Camera2 override token)

		IEnumerator Camera(JObject a, ReplyBox box) {
			var name = a.Value<string>("cam") ?? "Remote";
			if(!Cameras.available.Contains(name)) {
				box.reply = Reply.Error($"no Camera2 camera named '{name}' (have: {string.Join(", ", Cameras.available)})", 404);
				yield break;
			}
			Cameras.SetCameraActive(name, true);
			if(!tokens.TryGetValue(name, out var token) || token == null || !token.isValid) {
				token = OverrideToken.GetTokenForCamera(name);
				if(token == null) {
					box.reply = Reply.Error($"camera '{name}' is already overridden by another mod", 409);
					yield break;
				}
				tokens[name] = token;
			}
			token.position = Vec(a["pos"], token.position);
			token.rotation = Vec(a["rot"], token.rotation);
			if(a["fov"] != null) token.FOV = a.Value<float>("fov");
			var hide = a["hide"] as JObject;
			if(hide != null) {
				var v = token.visibleObjects;
				bool H(string k) => hide.Value<bool?>(k) ?? false;
				v.Notes = H("notes") ? NoteVisibility.Hidden : NoteVisibility.Visible;
				v.Walls = H("walls") ? WallVisiblity.Hidden : WallVisiblity.Visible;
				v.UI = !H("ui");
				v.Debris = !H("debris");
				v.CutParticles = !H("particles");
				v.Avatar = H("avatar") ? AvatarVisibility.Hidden : AvatarVisibility.Visible;
				try { v.Sabers = !H("sabers"); } catch { } // older Camera2 builds have no saber toggle
				token.UpdateVisibleObjects();
			}
			token.UpdatePositionAndRotation();
			// let the camera render with the new pose before anyone captures
			yield return null;
			yield return null;
			box.reply = Reply.Json(new { ok = true, cam = name, pos = new[] { token.position.x, token.position.y, token.position.z }, rot = new[] { token.rotation.x, token.rotation.y, token.rotation.z }, fov = token.FOV });
		}

		IEnumerator CameraRelease(JObject a, ReplyBox box) {
			var name = a.Value<string>("cam") ?? "Remote";
			if(tokens.TryGetValue(name, out var token) && token != null) token.Close();
			tokens.Remove(name);
			box.reply = Reply.Json(new { ok = true });
			yield break;
		}

		// -------------------------------------------------------------------------------------------
		// levels

		IEnumerator Play(JObject a, ReplyBox box) {
			if(frozen) yield return Resume(new ReplyBox());
			if(InLevel()) {
				yield return Menu(new ReplyBox());
			}
			var hash = a.Value<string>("hash");
			var levelId = a.Value<string>("levelId") ?? (hash != null ? "custom_level_" + hash.ToUpperInvariant() : null);
			if(levelId == null) { box.reply = Reply.Error("hash or levelId required"); yield break; }
			var characteristicName = a.Value<string>("characteristic") ?? "Standard";
			var difficultyName = a.Value<string>("difficulty") ?? "ExpertPlus";
			var start = a.Value<float?>("start") ?? 0f;
			var speed = a.Value<float?>("speed") ?? 1f;
			var envName = a.Value<string>("environment");
			var noFail = a.Value<bool?>("noFail") ?? true;

			var levelsModel = Find<BeatmapLevelsModel>();
			if(levelsModel == null) { box.reply = Reply.Error("BeatmapLevelsModel not found (still loading?)", 503); yield break; }
			var task = levelsModel.GetBeatmapLevelAsync(levelId, CancellationToken.None);
			var t0 = Time.realtimeSinceStartup;
			while(!task.IsCompleted) {
				if(Time.realtimeSinceStartup - t0 > 30) { box.reply = Reply.Error("level load timed out", 504); yield break; }
				yield return null;
			}
			if(task.IsFaulted || task.Result.isError || task.Result.beatmapLevel == null) {
				box.reply = Reply.Error($"level {levelId} not found (download it, then /refresh-songs)", 404);
				yield break;
			}
			var level = task.Result.beatmapLevel;
			if(!Enum.TryParse(difficultyName, true, out BeatmapDifficulty difficulty)) { box.reply = Reply.Error($"bad difficulty {difficultyName}"); yield break; }
			IDifficultyBeatmap beatmap = null;
			var available = new List<string>();
			foreach(var set in level.beatmapLevelData.difficultyBeatmapSets) {
				foreach(var d in set.difficultyBeatmaps) {
					available.Add($"{set.beatmapCharacteristic.serializedName}/{d.difficulty}");
					if(set.beatmapCharacteristic.serializedName == characteristicName && d.difficulty == difficulty) beatmap = d;
				}
			}
			if(beatmap == null) { box.reply = Reply.Error($"no {characteristicName}/{difficultyName}; available: {string.Join(", ", available)}", 404); yield break; }

			var pd = Find<PlayerDataModel>().playerData;
			var env = new OverrideEnvironmentSettings { overrideEnvironments = false };
			if(!string.IsNullOrEmpty(envName)) {
				var info = Resources.FindObjectsOfTypeAll<EnvironmentInfoSO>().FirstOrDefault(e => e.serializedName == envName);
				var normal = Resources.FindObjectsOfTypeAll<EnvironmentTypeSO>().FirstOrDefault(x => x.typeNameLocalizationKey == "NORMAL_ENVIRONMENT_TYPE");
				if(info == null) { box.reply = Reply.Error($"unknown environment {envName} (see /environments)", 404); yield break; }
				env = new OverrideEnvironmentSettings { overrideEnvironments = true };
				env.SetEnvironmentInfoForType(normal, info);
			}
			var practice = new PracticeSettings();
			SetMember(practice, start, "startSongTime", "_startSongTime");
			SetMember(practice, speed, "songSpeedMul", "_songSpeedMul");
			var modifiers = pd.gameplayModifiers.CopyWith(noFailOn0Energy: noFail);

			var helper = Find<MenuTransitionsHelper>();
			var method = typeof(MenuTransitionsHelper).GetMethods(BindingFlags.Instance | BindingFlags.Public)
				.Where(m => m.Name == "StartStandardLevel").OrderByDescending(m => m.GetParameters().Length).FirstOrDefault();
			if(helper == null || method == null) { box.reply = Reply.Error("MenuTransitionsHelper.StartStandardLevel not found", 500); yield break; }
			var byName = new Dictionary<string, object> {
				["gameMode"] = "Solo",
				["difficultyBeatmap"] = beatmap,
				["previewBeatmapLevel"] = level,
				["overrideEnvironmentSettings"] = env,
				["overrideColorScheme"] = pd.colorSchemesSettings.GetOverrideColorScheme(),
				["gameplayModifiers"] = modifiers,
				["playerSpecificSettings"] = pd.playerSpecificSettings,
				["practiceSettings"] = practice,
				["backButtonText"] = "Menu",
				["useTestNoteCutSoundEffects"] = false,
				["startPaused"] = false,
			};
			var ps = method.GetParameters();
			var args = new object[ps.Length];
			for(var i = 0; i < ps.Length; i++) {
				if(byName.TryGetValue(ps[i].Name, out var v)) args[i] = v;
				else args[i] = ps[i].ParameterType.IsValueType ? Activator.CreateInstance(ps[i].ParameterType) : null;
			}
			method.Invoke(helper, args);

			// wait for the game scene and its clock
			t0 = Time.realtimeSinceStartup;
			while(Atsc() == null || Atsc().songTime < start) {
				if(Time.realtimeSinceStartup - t0 > 60) { box.reply = Reply.Error("game scene did not start", 504); yield break; }
				yield return null;
			}
			var atsc = Atsc();
			box.reply = Reply.Json(new { ok = true, levelId, characteristic = characteristicName, difficulty = difficulty.ToString(), songTime = atsc.songTime, songEndTime = atsc.songEndTime, parameters = ps.Select(p => p.Name).ToArray() });
		}

		IEnumerator Freeze(JObject a, ReplyBox box) {
			var atsc = Atsc();
			if(atsc == null) { box.reply = Reply.Error("not in a level"); yield break; }
			var at = a.Value<float?>("at");
			var timeout = a.Value<float?>("timeout") ?? 120f;
			if(at.HasValue) {
				if(atsc.songTime > at.Value + 0.05f) { box.reply = Reply.Error($"song is already at {atsc.songTime:F2}s (past {at.Value}); /play again with an earlier start"); yield break; }
				var t0 = Time.realtimeSinceStartup;
				while(atsc != null && atsc.songTime < at.Value) {
					if(Time.realtimeSinceStartup - t0 > timeout) { box.reply = Reply.Error("freeze timed out", 504); yield break; }
					yield return null;
					atsc = Atsc();
				}
			}
			if(atsc == null) { box.reply = Reply.Error("level ended"); yield break; }
			atsc.Pause();
			Time.timeScale = 0f;
			frozen = true;
			yield return null;
			box.reply = Reply.Json(new { ok = true, songTime = atsc.songTime });
		}

		IEnumerator Resume(ReplyBox box) {
			Time.timeScale = 1f;
			var atsc = Atsc();
			if(frozen && atsc != null) atsc.Resume();
			frozen = false;
			box.reply = Reply.Json(new { ok = true });
			yield break;
		}

		IEnumerator Menu(ReplyBox box) {
			if(frozen) yield return Resume(new ReplyBox());
			if(!InLevel()) { box.reply = Reply.Json(new { ok = true, alreadyInMenu = true }); yield break; }
			var pause = Find<PauseMenuManager>();
			var m = pause?.GetType().GetMethod("MenuButtonPressed", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
			if(m == null) { box.reply = Reply.Error("PauseMenuManager.MenuButtonPressed not found", 500); yield break; }
			m.Invoke(pause, null);
			var t0 = Time.realtimeSinceStartup;
			while(InLevel()) {
				if(Time.realtimeSinceStartup - t0 > 30) { box.reply = Reply.Error("still in the level", 504); yield break; }
				yield return null;
			}
			// give the menu a moment to settle
			yield return new WaitForSecondsRealtime(1f);
			box.reply = Reply.Json(new { ok = true });
		}

		IEnumerator RefreshSongs(ReplyBox box) {
			var loaderType = AppDomain.CurrentDomain.GetAssemblies().Select(x => x.GetType("SongCore.Loader")).FirstOrDefault(t => t != null);
			var instance = loaderType?.GetProperty("Instance", BindingFlags.Static | BindingFlags.Public)?.GetValue(null);
			var refresh = loaderType?.GetMethod("RefreshSongs", BindingFlags.Instance | BindingFlags.Public);
			if(instance == null || refresh == null) { box.reply = Reply.Error("SongCore not found", 500); yield break; }
			refresh.Invoke(instance, new object[] { false });
			var areLoaded = loaderType.GetProperty("AreSongsLoaded", BindingFlags.Static | BindingFlags.Public);
			yield return new WaitForSecondsRealtime(0.5f);
			var t0 = Time.realtimeSinceStartup;
			while(areLoaded != null && !(bool)areLoaded.GetValue(null)) {
				if(Time.realtimeSinceStartup - t0 > 120) break;
				yield return new WaitForSecondsRealtime(0.25f);
			}
			box.reply = Reply.Json(new { ok = true });
		}

		// -------------------------------------------------------------------------------------------
		// capture

		static IEnumerator Capture(int superSize, Action<byte[]> done) {
			yield return new WaitForEndOfFrame();
			var tex = ScreenCapture.CaptureScreenshotAsTexture(Math.Max(1, superSize));
			var png = tex.EncodeToPNG();
			UnityEngine.Object.Destroy(tex);
			done(png);
		}

		IEnumerator Screenshot(JObject a, ReplyBox box) {
			byte[] png = null;
			// a couple of frames so the frozen scene has settled into the back buffer
			yield return null;
			yield return null;
			yield return Capture(a.Value<int?>("superSize") ?? 1, b => png = b);
			box.reply = new Reply { contentType = "image/png", body = png };
		}

		/// <summary>
		/// Batch: optional freeze at a song time, then one capture per camera pose.
		/// { at?, cam?, hide?, poses: [{ pos, rot, fov }] } -> { images: [base64 png], songTime }
		/// </summary>
		IEnumerator Shots(JObject a, ReplyBox box) {
			if(a["at"] != null) {
				var fb = new ReplyBox();
				yield return Freeze(a, fb);
				if(fb.reply != null && fb.reply.status != 200) { box.reply = fb.reply; yield break; }
			}
			var poses = a["poses"] as JArray ?? new JArray(new JObject());
			var images = new List<string>();
			foreach(var pose in poses) {
				var p = (JObject)pose.DeepClone();
				p["cam"] = a["cam"];
				if(p["hide"] == null && a["hide"] != null) p["hide"] = a["hide"];
				var cb = new ReplyBox();
				yield return Camera(p, cb);
				if(cb.reply != null && cb.reply.status != 200) { box.reply = cb.reply; yield break; }
				yield return null;
				yield return null;
				byte[] png = null;
				yield return Capture(a.Value<int?>("superSize") ?? 1, b => png = b);
				images.Add(Convert.ToBase64String(png));
			}
			var atsc = Atsc();
			box.reply = Reply.Json(new { ok = true, songTime = atsc != null ? atsc.songTime : (float?)null, images });
		}
	}
}
