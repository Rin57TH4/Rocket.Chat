import { Meteor } from 'meteor/meteor';
import { RocketChat } from 'meteor/rocketchat:lib';
import LivechatVisitors from '../models/LivechatVisitors';
import { LivechatCustomField } from '../models';

Meteor.methods({
	'livechat:setCustomField'(token, key, value, overwrite = true) {
		const customField = LivechatCustomField.findOneById(key);
		if (customField) {
			if (customField.scope === 'room') {
				return RocketChat.models.Rooms.updateLivechatDataByToken(token, key, value, overwrite);
			} else {
				// Save in user
				return LivechatVisitors.updateLivechatDataByToken(token, key, value, overwrite);
			}
		}

		return true;
	},
});
