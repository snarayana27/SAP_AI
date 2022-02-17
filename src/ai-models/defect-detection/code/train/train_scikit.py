# -*- coding: utf-8 -*-
"""
Training script to showcase the end-to-end training and evaluation script.
"""

import math
import numpy as np
import pandas as pd
import tensorflow as tf
import datetime
import itertools
import logging
from scipy import ndimage, misc
from os.path import exists
from joblib import load, dump
from os import makedirs
from os import environ

import keras
from keras import backend as K
from tensorflow.keras import layers
from tensorflow.keras import models
from tensorflow.keras import utils as np_utils

from keras.callbacks import EarlyStopping, ModelCheckpoint
from keras.models import Sequential, load_model
from keras.layers import Dense, Flatten, Reshape, Conv1D, MaxPooling1D, AveragePooling1D,\
UpSampling1D, InputLayer

from sklearn.metrics import accuracy_score, confusion_matrix, roc_curve, auc
from sklearn.model_selection import cross_val_score, train_test_split, StratifiedKFold, GridSearchCV
from sklearn.preprocessing import MaxAbsScaler
import joblib
from sklearn.neighbors import LocalOutlierFactor
from sklearn import cluster, datasets

import random
import os
import cv2

FORMAT = "%(asctime)s:%(name)s:%(levelname)s - %(message)s"
# Use filename="file.log" as a param to logging to log to a file
logging.basicConfig(format=FORMAT, level=logging.INFO)


class TrainSKInterface:
    def __init__(self) -> None:
        # Set the params for the training below
        self.image_pipeline = None
        self.dataset_all = None
        self.train, self.val, self.test = None, None, None
        self.target_classes = None
        self.dataset_name = "lgp_dataset"
        self.model_name = "classifier_pipeline.pkl"
        self.output_path = "/Users/I559573/Downloads/D2V2.0/D2V_Datasets/ImageSamples"
        self.file_name = "/Users/I559573/Downloads/D2V2.0/D2V_Datasets/ImageSamples/lgp_dataset"
        
    def create_dataset_bin(self):
        IMG_WIDTH=224
        IMG_HEIGHT=224
        img_data_array = []
        for file in os.listdir(img_folder):
                image_path = os.path.join(img_folder, file)
                image = cv2.imread(image_path, cv2.IMREAD_COLOR)
                image = cv2.resize(image, (IMG_HEIGHT, IMG_WIDTH),interpolation = cv2.INTER_AREA)
                image = np.array(image)
                image = image.astype('float32')
                image /= 255
                image = image.tobytes()
                img_data_array.append(image)
        return img_data_array 
    

    def read_dataset(self) -> None:
        """
        Reads the images file from path
        """
        
        path_img_ok = self.file_name + "/Images/OK/"
        path_img_ko = self.file_name + "/Images/NG/"
        print(path_img_ok)
        print(path_img_ko)
        
        img_dataset_ok_bin = create_dataset_bin(path_img_ok)
        img_dataset_ko_bin = create_dataset_bin(path_img_ko)

        df_img_dataset_ok = pd.DataFrame(columns = ['image','label'])
        df_img_dataset_ok['image'] = img_dataset_ok_bin
        df_img_dataset_ok['label'] = 0
        df_img_dataset_ko = pd.DataFrame(columns = ['image','label'])
        df_img_dataset_ko['image'] = img_dataset_ko_bin
        df_img_dataset_ko['label'] = 1

        self.dataset_all = pd.concat([df_img_dataset_ok,df_img_dataset_ko], ignore_index=True)
        self.dataset_all = df_img_dataset_all.sample(frac=1).reset_index(drop=True)
        self.target_classes = self.dataset_all["label"].unique()
        print(f"No. of training examples: {self.dataset_all.shape[0]}")
        print(f"Classes: {self.target_classes}")
        
        return None

    def split_dataset(self) -> None:
        """
        Split the dataset into train, validate and test

        Raises:
            Error: if dataset_train and dataset_test are not set
        """
        if self.dataset_all is None:
            raise Exception("Train or test data not set")

        self.train, self.val = train_test_split(self.dataset_all, test_size=0.97, random_state=25)
        self.val, self.test = train_test_split(df_img_dataset_test, test_size=0.97, random_state=25)

        print(f"No. of training examples: {self.train.shape[0]}")
        print(f"No. of validation examples: {self.val.shape[0]}")

        return None
    
    def convert_back(self):
        temp_arr = []
        for i in df['image'].values:
            a = np.frombuffer(i, dtype=np.float32)
            a = a.reshape(224,224,3)
            temp_arr.append(a)
            #print(a.shape)
        return temp_arr
    
    def prepare_model(self):
    
        base_model = tf.keras.applications.vgg16.VGG16(
            input_shape = (224, 224, 3), # Shape of our images
            include_top = False, # Leave out the last fully connected layer
            weights = 'imagenet'
        )

        for layer in base_model.layers:
            if(layer.name == 'block4_conv1'):
                break
            else:
                layer.trainable = False

        # Flatten the output layer to 1 dimension
        x = layers.Flatten()(base_model.output)

        # Add a fully connected layer with 512 hidden units and ReLU activation
        x = layers.Dense(512, activation='relu')(x)

        # Add a dropout rate of 0.5
        #x = layers.Dropout(0.5)(x)

        # Add a final sigmoid layer with 1 node for classification output
        x = layers.Dense(1, activation='sigmoid')(x)

        self.image_pipeline = tf.keras.models.Model(base_model.input, x)

        self.image_pipeline.compile(optimizer = tf.keras.optimizers.RMSprop(learning_rate=1e-5),
                      loss = 'binary_crossentropy', 
                      metrics = ['accuracy']
                     )
        
        self.image_pipeline.summary()
        
        return None

    def train_model(self) -> None:
        """
        Train and save the model
        """
        
        img_train = convert_back(self.train)
        img_val = convert_back(self.val)
        
        print(len(img_train))
        print(len(img_test))
        print(len(img_val))
        print(img_train[0].shape)
        print(img_test[0].shape)
        print(img_val[0].shape)

        self.image_pipeline.fit(
            x=np.array(img_train, np.float32), 
            y=np.array(list(map(int,df_img_dataset_train['label'])), np.float32), 
            validation_data = (np.array(img_val, np.float32), df_img_dataset_val['label'].values)
            #,steps_per_epoch = 100
            ,epochs = 2
        )

        return None

    def save_model(self) -> None:
        """
        Saves the model to the local path
        """
        
        logging.info(f"Writing tokenizer into {self.output_path}")
        if not exists(self.output_path):
            makedirs(self.output_path)
        # Save the Tokenizer and target classes to pickle file
        with open(f"{self.output_path}/{self.model_name}", "wb") as handle:
            dump([self.image_pipeline, self.target_classes], handle)

        return None

    def get_model(self) -> None:
        """
        Get the model if it is available locally
        """
        
        if exists(f"{self.output_path}/{self.model_name}"):
            logging.info(f"Loading classifier pipeline from {self.output_path}")
            with open(f"{self.output_path}/{self.model_name}", "rb") as handle:
                [self.image_pipeline, self.target_classes] = load(handle)
        else:
            logging.info(f"Model has not been trained yet!")

        return None

    def infer_model(self) -> str:
        """
        Perform an inference on the model that was trained
        """
        if self.image_pipeline is None:
            self.get_model()

        img_test = np.array(convert_back(self.test), np.float32)
        print(img_test[0].shape)
        infer_data = np.array(img_test[0])
        logging.info(f"-----START INFERENCE-----")
        prediction = self.image_pipeline.predict([infer_data])
        predicted_label = self.target_classes[prediction[0]]
        logging.info(f"The input '{infer_data}' was predicted as '{predicted_label}'")
        logging.info(f"-----END INFERENCE-----")

        return predicted_label

    def run_workflow(self) -> None:
        """
        Run the training script with all the necessary steps
        """
        self.read_dataset()
        self.split_dataset()
            
        self.get_model()
        if self.image_pipeline is None:
            # Train the model if no model is available
            logging.info(f"Training classifier and saving it locally")
            self.prepare_model()
            self.train_model()
            self.save_model()

        self.infer_model()

        return None


if __name__ == "__main__":
    train_obj = TrainSKInterface()
    train_obj.run_workflow()