import { Meteor } from 'meteor/meteor';
import { HTTP } from 'meteor/http';
import { API } from 'meteor/rocketchat:api';
import Busboy from 'busboy';

export class AppsRestApi {
	constructor(orch, manager) {
		this._orch = orch;
		this._manager = manager;
		this.api = new API.ApiClass({
			version: 'apps',
			useDefaultAuth: true,
			prettyJson: false,
			enableCors: false,
			auth: API.getUserAuth(),
		});

		this.addManagementRoutes();
	}

	_handleFile(request, fileField) {
		const busboy = new Busboy({ headers: request.headers });

		return Meteor.wrapAsync((callback) => {
			busboy.on('file', Meteor.bindEnvironment((fieldname, file) => {
				if (fieldname !== fileField) {
					return callback(new Meteor.Error('invalid-field', `Expected the field "${ fileField }" but got "${ fieldname }" instead.`));
				}

				const fileData = [];
				file.on('data', Meteor.bindEnvironment((data) => {
					fileData.push(data);
				}));

				file.on('end', Meteor.bindEnvironment(() => callback(undefined, Buffer.concat(fileData))));
			}));

			request.pipe(busboy);
		})();
	}

	addManagementRoutes() {
		const orchestrator = this._orch;
		const manager = this._manager;
		const fileHandler = this._handleFile;

		this.api.addRoute('', { authRequired: true, permissionsRequired: ['manage-apps'] }, {
			get() {
				const apps = manager.get().map((prl) => {
					const info = prl.getInfo();
					info.languages = prl.getStorageItem().languageContent;
					info.status = prl.getStatus();

					return info;
				});

				return API.v1.success({ apps });
			},
			post() {
				let buff;

				if (this.bodyParams.url) {
					const result = HTTP.call('GET', this.bodyParams.url, { npmRequestOptions: { encoding: 'base64' } });

					if (result.statusCode !== 200 || !result.headers['content-type'] || result.headers['content-type'] !== 'application/zip') {
						return API.v1.failure({ error: 'Invalid url. It doesn\'t exist or is not "application/zip".' });
					}

					buff = Buffer.from(result.content, 'base64');
				} else {
					buff = fileHandler(this.request, 'app');
				}

				if (!buff) {
					return API.v1.failure({ error: 'Failed to get a file to install for the App. ' });
				}

				const aff = Promise.await(manager.add(buff.toString('base64'), false));
				const info = aff.getAppInfo();

				// If there are compiler errors, there won't be an App to get the status of
				if (aff.getApp()) {
					info.status = aff.getApp().getStatus();
				} else {
					info.status = 'compiler_error';
				}

				return API.v1.success({
					app: info,
					implemented: aff.getImplementedInferfaces(),
					compilerErrors: aff.getCompilerErrors(),
				});
			},
		});

		this.api.addRoute('languages', { authRequired: false }, {
			get() {
				const apps = manager.get().map((prl) => ({
					id: prl.getID(),
					languages: prl.getStorageItem().languageContent,
				}));

				return API.v1.success({ apps });
			},
		});

		this.api.addRoute(':id', { authRequired: true, permissionsRequired: ['manage-apps'] }, {
			get() {
				console.log('Getting:', this.urlParams.id);
				const prl = manager.getOneById(this.urlParams.id);

				if (prl) {
					const info = prl.getInfo();
					info.status = prl.getStatus();

					return API.v1.success({ app: info });
				} else {
					return API.v1.notFound(`No App found by the id of: ${ this.urlParams.id }`);
				}
			},
			post() {
				console.log('Updating:', this.urlParams.id);
				// TODO: Verify permissions

				let buff;

				if (this.bodyParams.url) {
					const result = HTTP.call('GET', this.bodyParams.url, { npmRequestOptions: { encoding: 'base64' } });

					if (result.statusCode !== 200 || !result.headers['content-type'] || result.headers['content-type'] !== 'application/zip') {
						return API.v1.failure({ error: 'Invalid url. It doesn\'t exist or is not "application/zip".' });
					}

					buff = Buffer.from(result.content, 'base64');
				} else {
					buff = fileHandler(this.request, 'app');
				}

				if (!buff) {
					return API.v1.failure({ error: 'Failed to get a file to install for the App. ' });
				}

				const aff = Promise.await(manager.update(buff.toString('base64')));
				const info = aff.getAppInfo();

				// Should the updated version have compiler errors, no App will be returned
				if (aff.getApp()) {
					info.status = aff.getApp().getStatus();
				} else {
					info.status = 'compiler_error';
				}

				return API.v1.success({
					app: info,
					implemented: aff.getImplementedInferfaces(),
					compilerErrors: aff.getCompilerErrors(),
				});
			},
			delete() {
				console.log('Uninstalling:', this.urlParams.id);
				const prl = manager.getOneById(this.urlParams.id);

				if (prl) {
					Promise.await(manager.remove(prl.getID()));

					const info = prl.getInfo();
					info.status = prl.getStatus();

					return API.v1.success({ app: info });
				} else {
					return API.v1.notFound(`No App found by the id of: ${ this.urlParams.id }`);
				}
			},
		});

		this.api.addRoute(':id/icon', { authRequired: true, permissionsRequired: ['manage-apps'] }, {
			get() {
				console.log('Getting the App\'s Icon:', this.urlParams.id);
				const prl = manager.getOneById(this.urlParams.id);

				if (prl) {
					const info = prl.getInfo();

					return API.v1.success({ iconFileContent: info.iconFileContent });
				} else {
					return API.v1.notFound(`No App found by the id of: ${ this.urlParams.id }`);
				}
			},
		});

		this.api.addRoute(':id/languages', { authRequired: false }, {
			get() {
				console.log(`Getting ${ this.urlParams.id }'s languages..`);
				const prl = manager.getOneById(this.urlParams.id);

				if (prl) {
					const languages = prl.getStorageItem().languageContent || {};

					return API.v1.success({ languages });
				} else {
					return API.v1.notFound(`No App found by the id of: ${ this.urlParams.id }`);
				}
			},
		});

		this.api.addRoute(':id/logs', { authRequired: true, permissionsRequired: ['manage-apps'] }, {
			get() {
				console.log(`Getting ${ this.urlParams.id }'s logs..`);
				const prl = manager.getOneById(this.urlParams.id);

				if (prl) {
					const { offset, count } = this.getPaginationItems();
					const { sort, fields, query } = this.parseJsonQuery();

					const ourQuery = Object.assign({}, query, { appId: prl.getID() });
					const options = {
						sort: sort ? sort : { _updatedAt: -1 },
						skip: offset,
						limit: count,
						fields,
					};

					const logs = Promise.await(orchestrator.getLogStorage().find(ourQuery, options));

					return API.v1.success({ logs });
				} else {
					return API.v1.notFound(`No App found by the id of: ${ this.urlParams.id }`);
				}
			},
		});

		this.api.addRoute(':id/settings', { authRequired: true, permissionsRequired: ['manage-apps'] }, {
			get() {
				console.log(`Getting ${ this.urlParams.id }'s settings..`);
				const prl = manager.getOneById(this.urlParams.id);

				if (prl) {
					const settings = Object.assign({}, prl.getStorageItem().settings);

					Object.keys(settings).forEach((k) => {
						if (settings[k].hidden) {
							delete settings[k];
						}
					});

					return API.v1.success({ settings });
				} else {
					return API.v1.notFound(`No App found by the id of: ${ this.urlParams.id }`);
				}
			},
			post() {
				console.log(`Updating ${ this.urlParams.id }'s settings..`);
				if (!this.bodyParams || !this.bodyParams.settings) {
					return API.v1.failure('The settings to update must be present.');
				}

				const prl = manager.getOneById(this.urlParams.id);

				if (!prl) {
					return API.v1.notFound(`No App found by the id of: ${ this.urlParams.id }`);
				}

				const { settings } = prl.getStorageItem();

				const updated = [];
				this.bodyParams.settings.forEach((s) => {
					if (settings[s.id]) {
						Promise.await(manager.getSettingsManager().updateAppSetting(this.urlParams.id, s));
						// Updating?
						updated.push(s);
					}
				});

				return API.v1.success({ updated });
			},
		});

		this.api.addRoute(':id/settings/:settingId', { authRequired: true, permissionsRequired: ['manage-apps'] }, {
			get() {
				console.log(`Getting the App ${ this.urlParams.id }'s setting ${ this.urlParams.settingId }`);

				try {
					const setting = manager.getSettingsManager().getAppSetting(this.urlParams.id, this.urlParams.settingId);

					API.v1.success({ setting });
				} catch (e) {
					if (e.message.includes('No setting found')) {
						return API.v1.notFound(`No Setting found on the App by the id of: "${ this.urlParams.settingId }"`);
					} else if (e.message.includes('No App found')) {
						return API.v1.notFound(`No App found by the id of: ${ this.urlParams.id }`);
					} else {
						return API.v1.failure(e.message);
					}
				}
			},
			post() {
				console.log(`Updating the App ${ this.urlParams.id }'s setting ${ this.urlParams.settingId }`);

				if (!this.bodyParams.setting) {
					return API.v1.failure('Setting to update to must be present on the posted body.');
				}

				try {
					Promise.await(manager.getSettingsManager().updateAppSetting(this.urlParams.id, this.bodyParams.setting));

					return API.v1.success();
				} catch (e) {
					if (e.message.includes('No setting found')) {
						return API.v1.notFound(`No Setting found on the App by the id of: "${ this.urlParams.settingId }"`);
					} else if (e.message.includes('No App found')) {
						return API.v1.notFound(`No App found by the id of: ${ this.urlParams.id }`);
					} else {
						return API.v1.failure(e.message);
					}
				}
			},
		});

		this.api.addRoute(':id/apis', { authRequired: true, permissionsRequired: ['manage-apps'] }, {
			get() {
				console.log(`Getting ${ this.urlParams.id }'s apis..`);
				const prl = manager.getOneById(this.urlParams.id);

				if (prl) {
					return API.v1.success({
						apis: manager.apiManager.listApis(this.urlParams.id),
					});
				} else {
					return API.v1.notFound(`No App found by the id of: ${ this.urlParams.id }`);
				}
			},
		});

		this.api.addRoute(':id/status', { authRequired: true, permissionsRequired: ['manage-apps'] }, {
			get() {
				console.log(`Getting ${ this.urlParams.id }'s status..`);
				const prl = manager.getOneById(this.urlParams.id);

				if (prl) {
					return API.v1.success({ status: prl.getStatus() });
				} else {
					return API.v1.notFound(`No App found by the id of: ${ this.urlParams.id }`);
				}
			},
			post() {
				if (!this.bodyParams.status || typeof this.bodyParams.status !== 'string') {
					return API.v1.failure('Invalid status provided, it must be "status" field and a string.');
				}

				console.log(`Updating ${ this.urlParams.id }'s status...`, this.bodyParams.status);
				const prl = manager.getOneById(this.urlParams.id);

				if (prl) {
					const result = Promise.await(manager.changeStatus(prl.getID(), this.bodyParams.status));

					return API.v1.success({ status: result.getStatus() });
				} else {
					return API.v1.notFound(`No App found by the id of: ${ this.urlParams.id }`);
				}
			},
		});
	}
}
